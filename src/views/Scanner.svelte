<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { HTMLCanvasElementLuminanceSource } from '@zxing/browser';
  import { BarcodeFormat, DecodeHintType, MultiFormatReader, BinaryBitmap, HybridBinarizer } from '@zxing/library';
  import { measure, enhance } from '../lib/scanimg';

  /** mode "sale": stays open and calls onCode for each scan. mode "pick": closes after one code. */
  export let mode: 'sale' | 'pick' = 'sale';
  export let onCode: (code: string) => Promise<{ status: string; notFound?: boolean } | void>;
  export let onRegister: ((code: string) => void) | null = null;
  export let onClose: () => void;
  export let summary = '';

  let video: HTMLVideoElement;
  let stream: MediaStream | undefined;
  let alive = true;
  let status = 'Point the camera at a barcode';
  let error = '';
  let torchAvail = false, torchOn = false;
  let manual = false, manualText = '';
  let notFound = '';
  let last = '', lastAt = 0;

  async function handle(code: string) {
    if (notFound || manual) return;
    const t = Date.now();
    if (code === last && t - lastAt < 2000) return;           // ignore the same code for 2s: no accidental double add
    last = code; lastAt = t;
    if (navigator.vibrate) navigator.vibrate(40);
    if (mode === 'pick') { await onCode(code); onClose(); return; }
    const r = await onCode(code);
    if (r) { status = r.status; if (r.notFound) notFound = code; }
  }

  const FORMATS = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE];
  const NATIVE = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];

  /** Asks the camera for continuous focus/exposure and brightens its own picture when the scene is dark (no flashlight needed). */
  async function tuneCamera(track: MediaStreamTrack, dark: boolean) {
    const caps: any = track.getCapabilities?.() ?? {};
    const adv: any = {};
    if (caps.focusMode?.includes?.('continuous')) adv.focusMode = 'continuous';
    if (caps.exposureMode?.includes?.('continuous')) adv.exposureMode = 'continuous';
    if (caps.whiteBalanceMode?.includes?.('continuous')) adv.whiteBalanceMode = 'continuous';
    if (caps.exposureCompensation && dark) {                       // raise exposure by ~60% of the allowed range
      const { min, max } = caps.exposureCompensation; adv.exposureCompensation = min + (max - min) * 0.8;
    }
    if (Object.keys(adv).length) { try { await track.applyConstraints({ advanced: [adv] }); } catch { /* not supported: ignore */ } }
  }

  onMount(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { error = 'This browser cannot access the camera (needs HTTPS). You can type the barcode instead.'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream; await video.play();
      const track = stream.getVideoTracks()[0];
      torchAvail = !!((track.getCapabilities?.() as any)?.torch);
      await tuneCamera(track, false);
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera for this site in your browser settings, or type the barcode instead.'
        : 'Could not start the camera. You can type the barcode instead.';
      return;
    }
    // Decoders: the phone's own detector (fast, hardware-assisted) when it exists, ZXing as the fallback.
    let native: any = null;
    try {
      const BD = (window as any).BarcodeDetector;
      if (BD) { const sup: string[] = (await BD.getSupportedFormats?.()) ?? NATIVE; const fm = NATIVE.filter((f) => sup.includes(f)); if (fm.length) native = new BD({ formats: fm }); }
    } catch { native = null; }
    const zx = new MultiFormatReader();
    const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, FORMATS], [DecodeHintType.TRY_HARDER, true]]);
    zx.setHints(hints);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const decode = async (): Promise<string | null> => {
      if (native) { try { const r = await native.detect(canvas); if (r?.[0]?.rawValue) return r[0].rawValue; } catch { /* fall through to ZXing */ } }
      try { return zx.decode(new BinaryBitmap(new HybridBinarizer(new HTMLCanvasElementLuminanceSource(canvas)))).getText(); }
      catch { return null; }                                       // nothing found in this frame
    };

    let started = Date.now(), tuned = false, tick = 0;
    const loop = async () => {
      if (!alive) return;
      try {
        if (video.readyState >= 2 && video.videoWidth && !notFound && !manual) {
          const scale = Math.min(1, 1280 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const st = measure(img.data);
          let code = await decode();                               // 1st try: the picture as it is
          if (!code && st.weak) {                                  // dark or flat picture: clean it up and try again
            enhance(img.data); ctx.putImageData(img, 0, 0); code = await decode();
            if (!tuned && st.mean < 90 && stream) { tuned = true; tuneCamera(stream.getVideoTracks()[0], true); }
          }
          if (code) { started = Date.now(); handle(code); }
          else if (Date.now() - started > 6000 && !torchOn) { status = torchAvail ? 'Hard to read here. Hold steady, or tap Torch' : 'Hard to read here. Hold steady, or type the barcode'; }
          tick++;
        }
      } catch { /* a bad frame must never stop scanning */ }
      setTimeout(loop, 60);
    };
    loop();
  });
  onDestroy(() => {
    alive = false;
    (video?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());   // releases the camera
    stream?.getTracks().forEach((t) => t.stop());
  });

  async function toggleTorch() {
    const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0]; if (!track) return;
    try { torchOn = !torchOn; await track.applyConstraints({ advanced: [{ torch: torchOn } as any] }); } catch { torchOn = false; }
  }
  async function submitManual() {
    const c = manualText.trim(); manual = false; manualText = '';
    if (!c) return;
    last = ''; await handle(c);
  }
</script>

<div class="scan">
  <!-- svelte-ignore a11y-media-has-caption -->
  <video bind:this={video} playsinline muted></video>
  <div class="frame"></div>
  <div class="info">
    {#if error}<div class="err" style="color:#ffb4ab">{error}</div>{:else}<div>{status}</div>{/if}
    {#if summary}<div style="font-weight:700;margin-top:4px">{summary}</div>{/if}
  </div>
  <div class="acts">
    {#if torchAvail}<button on:click={toggleTorch}>{torchOn ? '🔦 Off' : '🔦 Torch'}</button>{/if}
    <button on:click={() => (manual = true)}>⌨ Type barcode</button>
    <button style="background:#7fd69a" on:click={onClose}>{mode === 'sale' ? 'Done' : 'Cancel'}</button>
  </div>

  {#if manual}
    <div class="overlay"><div class="modal" style="color:var(--tx)">
      <h3>Enter barcode</h3>
      <!-- svelte-ignore a11y-autofocus -->
      <input bind:value={manualText} placeholder="Barcode / product code" autofocus on:keydown={(e) => e.key === 'Enter' && submitManual()} />
      <div class="row"><button class="btn alt" on:click={() => (manual = false)}>Cancel</button><button class="btn" on:click={submitManual}>OK</button></div>
    </div></div>
  {/if}
  {#if notFound}
    <div class="overlay"><div class="modal" style="color:var(--tx)">
      <h3>Product not found</h3>
      <p>Product not found. Would you like to register this product?</p><p class="muted">Barcode: {notFound}</p>
      <button class="btn" on:click={() => { const c = notFound; notFound = ''; onRegister?.(c); }}>Register Product</button>
      <button class="btn alt" on:click={() => { notFound = ''; manual = true; }}>Enter Barcode Manually</button>
      <button class="btn alt" on:click={() => (notFound = '')}>Scan Another Product</button>
      <button class="btn alt" on:click={() => { notFound = ''; onClose(); }}>Cancel</button>
    </div></div>
  {/if}
</div>

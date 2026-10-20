<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { BrowserMultiFormatReader } from '@zxing/browser';
  import { BarcodeFormat, DecodeHintType } from '@zxing/library';

  /** mode "sale": stays open and calls onCode for each scan. mode "pick": closes after one code. */
  export let mode: 'sale' | 'pick' = 'sale';
  export let onCode: (code: string) => Promise<{ status: string; notFound?: boolean } | void>;
  export let onRegister: ((code: string) => void) | null = null;
  export let onClose: () => void;
  export let summary = '';

  let video: HTMLVideoElement;
  let controls: { stop: () => void } | undefined;
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

  onMount(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { error = 'This browser cannot access the camera (needs HTTPS). You can type the barcode instead.'; return; }
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
    try {
      controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }, video,
        (result) => { if (result) handle(result.getText()); });
      const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
      torchAvail = !!(track && (track.getCapabilities?.() as any)?.torch);
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera for this site in your browser settings, or type the barcode instead.'
        : 'Could not start the camera. You can type the barcode instead.';
    }
  });
  onDestroy(() => {
    controls?.stop();                                           // releases the camera
    (video?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
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

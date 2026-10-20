<script lang="ts">
  import { settings } from '../lib/stores';
  export let onStart: () => void;
  $: name = $settings?.store_name || 'Provision POS';
  const bars = [3, 1, 2, 1, 4, 1, 2, 3, 1, 2, 1, 3, 2, 1, 4];
</script>

<div class="cover">
  <div class="blob b1"></div><div class="blob b2"></div>
  <div class="content">
    <div class="logo" aria-hidden="true">
      <div class="barcode">{#each bars as w, i}<span style="width:{w * 3}px;opacity:{i % 4 === 0 ? 0.6 : 1}"></span>{/each}</div>
      <div class="scanline"></div>
    </div>
    <h1>{name}</h1>
    <p class="tag">Sell · Scan · Stock · Report</p>
    <ul class="feats">
      <li>📷 Barcode scanning</li><li>🧾 Instant receipts</li><li>📦 Stock control</li><li>📈 Daily reports</li>
    </ul>
    <button class="start" on:click={onStart}>Start <span aria-hidden="true">→</span></button>
    <p class="foot">Works offline · Your data stays on this phone</p>
  </div>
</div>

<style>
  .cover { position: fixed; inset: 0; overflow: hidden; color: #fff; z-index: 20; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(155deg, #0e4a28 0%, #1b6b3a 45%, #2f9a58 100%); padding: env(safe-area-inset-top) 20px env(safe-area-inset-bottom); }
  .blob { position: absolute; border-radius: 50%; filter: blur(60px); opacity: .35; animation: float 12s ease-in-out infinite; }
  .b1 { width: 320px; height: 320px; background: #7fd69a; top: -90px; right: -90px; }
  .b2 { width: 280px; height: 280px; background: #f5c542; bottom: -100px; left: -80px; animation-delay: -6s; opacity: .22; }
  .content { position: relative; width: 100%; max-width: 420px; text-align: center; animation: rise .7s ease-out both; }
  .logo { position: relative; width: 132px; height: 132px; margin: 0 auto 22px; border-radius: 34px; background: rgba(255,255,255,.14);
    border: 1.5px solid rgba(255,255,255,.35); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; box-shadow: 0 18px 40px rgba(0,0,0,.25); }
  .barcode { display: flex; align-items: stretch; gap: 3px; height: 62px; }
  .barcode span { background: #fff; border-radius: 1px; display: block; }
  .scanline { position: absolute; left: 18px; right: 18px; height: 3px; border-radius: 2px; background: #ff5a4e; box-shadow: 0 0 12px #ff5a4e; animation: scan 2.2s ease-in-out infinite; }
  h1 { font-size: 2rem; line-height: 1.15; margin: 0 0 8px; letter-spacing: -.5px; word-break: break-word; }
  .tag { margin: 0 0 22px; opacity: .9; letter-spacing: 2px; font-size: .85rem; text-transform: uppercase; }
  .feats { list-style: none; padding: 0; margin: 0 0 30px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .feats li { background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.25); padding: 7px 12px; border-radius: 20px; font-size: .85rem; }
  .start { width: 100%; padding: 18px; font: inherit; font-size: 1.15rem; font-weight: 800; color: #0e4a28; background: #fff; border: 0; border-radius: 18px;
    box-shadow: 0 12px 28px rgba(0,0,0,.28); cursor: pointer; transition: transform .15s; }
  .start:active { transform: scale(.97); }
  .foot { margin: 16px 0 0; font-size: .8rem; opacity: .8; }
  @keyframes scan { 0%, 100% { top: 26px; } 50% { top: calc(100% - 29px); } }
  @keyframes float { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(20px, 26px); } }
  @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .blob, .scanline, .content { animation: none; } .scanline { top: 50%; } }
</style>

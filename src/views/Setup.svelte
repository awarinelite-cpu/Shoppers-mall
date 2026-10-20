<script lang="ts">
  import { setSettings } from '../lib/repo';
  import { toast, safe } from '../lib/stores';
  import { parseQty, fmtQty } from '../lib/money';
  let name = '', address = '', phone = '', cashier = '', low = '5';
  async function start() {
    if (!name.trim()) return toast('Enter the store name');
    await safe(() => setSettings({ store_name: name.trim(), address: address.trim(), phone: phone.trim(), cashier: cashier.trim(),
      low_default: fmtQty(parseQty(low) ?? 5000), footer: 'Thank you for shopping with us!', receipt_prefix: 'POS', default_pay: 'CASH', tax_bps: '0', setup_done: '1' }));
  }
</script>
<div class="shell">
  <header class="bar"><h1>Welcome to Provision POS</h1></header>
  <main>
    <p>Set up your store. You can change all of this later in Settings.</p>
    <label for="a">Store name *</label><input id="a" bind:value={name} />
    <label for="b">Store address (optional)</label><input id="b" bind:value={address} />
    <label for="c">Phone number (optional)</label><input id="c" bind:value={phone} inputmode="tel" />
    <label for="d">Cashier / attendant name (optional)</label><input id="d" bind:value={cashier} />
    <label for="e">Low-stock warning level (units)</label><input id="e" bind:value={low} inputmode="decimal" />
    <button class="btn" on:click={start}>Start</button>
    <p class="hint">Your data stays on this device (offline). Export a backup regularly from Settings.</p>
  </main>
</div>

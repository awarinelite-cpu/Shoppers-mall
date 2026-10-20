<script lang="ts">
  import { setSettings, setPin, exportBackup, restoreBackup } from '../lib/repo';
  import { settings, S, toast, safe, guard, confirmBox } from '../lib/stores';
  import { parseQty, fmtQty, fmtDate, METHODS } from '../lib/money';
  import { download } from '../lib/receipt';
  import Header from './Header.svelte';

  let name = S('store_name'), address = S('address'), phone = S('phone'), cashier = S('cashier'), footer = S('footer'), prefix = S('receipt_prefix', 'POS');
  let low = S('low_default', '5'), tax = String((parseInt(S('tax_bps', '0')) || 0) / 100), pay = S('default_pay', 'CASH'), allowNeg = S('allow_negative') === '1';
  let newPin = '', fileInput: HTMLInputElement;

  async function save() {
    const t = parseQty(tax), l = parseQty(low);
    if (!name.trim()) return toast('Store name is required');
    if (t === null || t > 100000 || l === null) return toast('Check tax and stock level');
    await guard(async () => { const r = await safe(() => setSettings({ store_name: name.trim(), address, phone, cashier, footer, receipt_prefix: prefix.trim() || 'POS',
      low_default: fmtQty(l), tax_bps: String(Math.round(t / 10)), default_pay: pay, allow_negative: allowNeg ? '1' : '0' })); if (r !== undefined) toast('Settings saved'); });
  }
  async function savePin() { if (newPin.length < 4) return toast('Use at least 4 digits'); await guard(async () => { await setPin(newPin); newPin = ''; toast('PIN saved'); }); }
  async function removePin() { await guard(async () => { await setPin(null); toast('PIN removed'); }); }
  async function backup() { const r = await safe(exportBackup); if (r) { download(`provision-pos-backup-${fmtDate(Date.now())}.json`, r, 'application/json'); await setSettings({ last_backup: String(Date.now()) }); toast('Backup downloaded'); } }
  async function picked() {
    const f = fileInput.files?.[0]; fileInput.value = ''; if (!f) return;
    const text = await f.text();
    if (!(await confirmBox('Replace all data?', 'Restoring REPLACES every product, sale and setting on this device with the backup contents. This cannot be undone.', 'Replace'))) return;
    await guard(async () => { const r = await safe(() => restoreBackup(text)); if (r) toast(r); });
  }
  $: lastBackup = $settings?.last_backup ? fmtDate(Number($settings.last_backup)) : 'never';
</script>
<Header title="Settings" />
<main>
  <label for="a">Store name</label><input id="a" bind:value={name} />
  <label for="b">Address</label><input id="b" bind:value={address} />
  <label for="c">Phone</label><input id="c" bind:value={phone} />
  <label for="d">Cashier name</label><input id="d" bind:value={cashier} />
  <label for="e">Receipt footer message</label><input id="e" bind:value={footer} />
  <label for="f">Receipt number prefix</label><input id="f" bind:value={prefix} />
  <label for="g">Default low-stock level (new products)</label><input id="g" bind:value={low} inputmode="decimal" />
  <label for="h">Tax % (0 = no tax)</label><input id="h" bind:value={tax} inputmode="decimal" />
  <label for="i">Default payment method</label><select id="i" bind:value={pay}>{#each Object.entries(METHODS) as [k, v]}<option value={k}>{v}</option>{/each}</select>
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" style="width:auto" bind:checked={allowNeg} /> Allow selling below zero stock</label>
  <button class="btn" on:click={save}>Save settings</button>

  <h3>Owner PIN</h3>
  <p class="hint">Protects editing products, adjusting stock, refunds, settings changes and restore.</p>
  <input bind:value={newPin} type="password" inputmode="numeric" placeholder="New PIN (digits)" on:input={() => (newPin = newPin.replace(/\D/g, ''))} />
  <div class="row"><button class="btn" on:click={savePin}>Set PIN</button><button class="btn alt" on:click={removePin}>Remove PIN</button></div>

  <h3>Backup & restore</h3>
  <p class="hint">Your data lives only in this browser on this device. If you clear browser data or lose the phone it is gone, so back up often. Last backup: <b>{lastBackup}</b>.
    To move to another phone: open the app there, finish setup, choose Restore and pick the file.</p>
  <button class="btn" on:click={backup}>Export backup</button>
  <button class="btn alt" on:click={() => fileInput.click()}>Restore backup</button>
  <input bind:this={fileInput} type="file" accept=".json,application/json" style="display:none" on:change={picked} />
</main>

<script lang="ts">
  import { setSettings, setPin, exportBackup, restoreBackup, restoreSnapshot, listSnapshots, markDailyDownload } from '../lib/repo';
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { settings, S, toast, safe, guard, confirmBox } from '../lib/stores';
  import { parseQty, fmtQty, fmtDate, METHODS } from '../lib/money';
  import { download, shareFile } from '../lib/receipt';
  import Header from './Header.svelte';

  let name = S('store_name'), address = S('address'), phone = S('phone'), cashier = S('cashier'), footer = S('footer'), prefix = S('receipt_prefix', 'POS');
  let low = S('low_default', '5'), tax = String((parseInt(S('tax_bps', '0')) || 0) / 100), pay = S('default_pay', 'CASH'), allowNeg = S('allow_negative') === '1';
  let newPin = '', fileInput: HTMLInputElement;
  let autoBackup = S('auto_backup') !== '0';
  const snaps = liveQuery(() => db.snapshots.orderBy('date').reverse().toArray());
  async function toggleAuto() { await setSettings({ auto_backup: autoBackup ? '1' : '0' }); }
  async function restoreSnap(key: string) {
    if (!(await confirmBox('Restore this copy?', 'This replaces current data with the in-app copy from ' + key + '. Your current data is kept as an undo copy named pre-restore.', 'Restore'))) return;
    await guard(async () => { const r = await safe(() => restoreSnapshot(key)); if (r) toast(r); });
  }

  async function save() {
    const t = parseQty(tax), l = parseQty(low);
    if (!name.trim()) return toast('Store name is required');
    if (t === null || t > 100000 || l === null) return toast('Check tax and stock level');
    await guard(async () => { const r = await safe(() => setSettings({ store_name: name.trim(), address, phone, cashier, footer, receipt_prefix: prefix.trim() || 'POS',
      low_default: fmtQty(l), tax_bps: String(Math.round(t / 10)), default_pay: pay, allow_negative: allowNeg ? '1' : '0' })); if (r !== undefined) toast('Settings saved'); });
  }
  async function savePin() { if (newPin.length < 4) return toast('Use at least 4 digits'); await guard(async () => { await setPin(newPin); newPin = ''; toast('PIN saved'); }); }
  async function removePin() { await guard(async () => { await setPin(null); toast('PIN removed'); }); }
  async function backup() { const r = await safe(exportBackup); if (r) { download(`provision-pos-backup-${fmtDate(Date.now())}.json`, r, 'application/json'); await markDailyDownload(); toast('Backup downloaded'); } }
  let restoreError = '', pasted = '';
  async function readFile(f: File): Promise<string> {
    try { return await f.text(); }
    catch { return await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f); }); }
  }
  async function runRestore(text: string, source: string) {
    restoreError = '';
    const head = text.replace(/\s+/g, ' ').slice(0, 80);
    const detail = `${source} · ${text.length} characters · starts with: "${head}"`;
    try {
      if (!(await confirmBox('Replace all data?', 'Restoring REPLACES every product, sale and setting on this device with the backup contents. An undo copy is kept.', 'Replace'))) return;
      await guard(async () => {
        try { const r = await restoreBackup(text); restoreError = ''; toast(r); }
        catch (e: any) { restoreError = (e?.message || 'Restore failed') + '\n' + detail; toast('Restore failed. See the red box below.'); }
      });
    } catch (e: any) { restoreError = (e?.message || 'Restore failed') + '\n' + detail; }
  }
  async function picked() {
    const f = fileInput.files?.[0]; if (!f) return;
    let text = '';
    try { text = await readFile(f); }
    catch (e: any) { restoreError = `The phone would not let the app read "${f.name}" (${e?.name || 'read error'}). Try the paste option below, or save the file to Downloads and pick it from there.`; return; }
    finally { fileInput.value = ''; }
    await runRestore(text, `File "${f.name}" (${f.size} bytes)`);
  }
  async function shareBackup() {
    const r = await safe(exportBackup); if (!r) return;
    const ok = await shareFile(`provision-pos-backup-${fmtDate(Date.now())}.json`, r, 'application/json');
    if (ok) await markDailyDownload(); else toast('Sharing files is not supported here. Use Export backup instead.');
  }
  async function copyBackup() { const r = await safe(exportBackup); if (r) { try { await navigator.clipboard.writeText(r); toast('Backup text copied. Paste it somewhere safe (e.g. a note or message to yourself).'); } catch { toast('Could not copy'); } } }
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
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" style="width:auto" bind:checked={autoBackup} on:change={toggleAuto} /> Auto-download a backup file the first time I open the app each day</label>
  <p class="hint">A web app cannot run while it is closed, so the daily backup happens when you tap Start each morning. Files go to your phone's Downloads folder.
    Also, the app keeps its own copy of the last 7 days (below). For protection if the phone is lost, move the files to Google Drive/WhatsApp, or ask for cloud sync.</p>
  <button class="btn" on:click={backup}>Export backup now</button>
  <button class="btn alt" on:click={shareBackup}>Share backup file (WhatsApp, Drive…)</button>
  <button class="btn alt" on:click={copyBackup}>Copy backup as text</button>
  <button class="btn alt" on:click={() => fileInput.click()}>Restore backup</button>
  {#if restoreError}<div class="card" style="border-color:var(--er)"><b class="err">Restore problem</b><pre style="white-space:pre-wrap;word-break:break-word;margin:6px 0 0;font-size:.85rem">{restoreError}</pre></div>{/if}
  <label for="paste">Or paste backup text here</label>
  <textarea id="paste" rows="3" bind:value={pasted} placeholder="Paste the backup text"></textarea>
  <button class="btn alt" disabled={!pasted.trim()} on:click={() => runRestore(pasted, 'Pasted text')}>Restore from pasted text</button>
  <h3>Copies kept inside the app</h3>
  {#if !$snaps?.length}<p class="hint">None yet. The first copy is made the next time you open the app.</p>{/if}
  {#each $snaps ?? [] as sn (sn.date)}
    <div class="item between" style="align-items:center;cursor:default"><span>{sn.date === 'pre-restore' ? 'Before last restore (undo)' : sn.date}</span><button class="sm" on:click={() => restoreSnap(sn.date)}>Restore</button></div>
  {/each}
  <input bind:this={fileInput} type="file" style="display:none" on:change={picked} />
</main>

<script lang="ts">
  import { setSettings, exportBackup, restoreBackup, restoreSnapshot, listSnapshots, markDailyDownload } from '../lib/repo';
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { settings, S, toast, safe, confirmBox } from '../lib/stores';
  import { parseQty, fmtQty, fmtDate, fmtDateTime, METHODS } from '../lib/money';
  import { download, shareFile } from '../lib/receipt';
  import { backupToDrive, listDriveBackups, downloadDriveBackup, folderLink, resetDriveSession, type DriveFile } from '../lib/drive';
  import Header from './Header.svelte';
  import SyncForm from './SyncForm.svelte';
  import { processPhotoQueue } from '../lib/photo';

  let name = S('store_name'), address = S('address'), phone = S('phone'), cashier = S('cashier'), footer = S('footer'), prefix = S('receipt_prefix', 'POS');
  let low = S('low_default', '5'), tax = String((parseInt(S('tax_bps', '0')) || 0) / 100), pay = S('default_pay', 'CASH');
  let fileInput: HTMLInputElement;
  let autoBackup = S('auto_backup') !== '0';
  const snaps = liveQuery(() => db.snapshots.orderBy('date').reverse().toArray());
  async function toggleAuto() { await setSettings({ auto_backup: autoBackup ? '1' : '0' }); }
  async function restoreSnap(key: string) {
    if (!(await confirmBox('Restore this copy?', 'This replaces current data with the in-app copy from ' + key + '. Your current data is kept as an undo copy named pre-restore.', 'Restore'))) return;
    const r = await safe(() => restoreSnapshot(key)); if (r) toast(r);
  }

  async function save() {
    const t = parseQty(tax), l = parseQty(low);
    if (!name.trim()) return toast('Store name is required');
    if (t === null || t > 100000 || l === null) return toast('Check tax and stock level');
    { const r = await safe(() => setSettings({ store_name: name.trim(), address, phone, cashier, footer, receipt_prefix: prefix.trim() || 'POS',
      low_default: fmtQty(l), tax_bps: String(Math.round(t / 10)), default_pay: pay, allow_negative: '1' })); if (r !== undefined) toast('Settings saved'); }
  }
  async function backup() { const r = await safe(exportBackup); if (r) { download(`provision-pos-backup-${fmtDate(Date.now())}.json`, r, 'application/json'); await markDailyDownload(); toast('Backup downloaded'); } }
  let photoCloud = S('photo_cloud'), photoPreset = S('photo_preset'), photoBusy = false;
  const photoWaiting = liveQuery(() => db.photoQueue.count());
  async function savePhotoHost() {
    if (!/^[A-Za-z0-9_-]*$/.test(photoCloud.trim()) || !/^[A-Za-z0-9_.-]*$/.test(photoPreset.trim())) return toast('Cloud name and preset use only letters, numbers, - and _');
    await setSettings({ photo_cloud: photoCloud.trim(), photo_preset: photoPreset.trim() }); toast('Photo hosting saved');
  }
  async function retryPhotos() { photoBusy = true; const r = await processPhotoQueue(); photoBusy = false; toast(r.error ? 'Not uploaded: ' + r.error : r.left ? r.left + ' photo(s) still waiting' : 'All photos uploaded'); }
  let restoreError = '', pasted = '';
  let driveEmail = S('drive_email'), clientId = S('drive_client_id'), driveBusy = false, driveFiles: DriveFile[] | null = null;
  $: driveOn = $settings?.drive_enabled === '1';
  $: driveFolder = $settings?.drive_folder_id ? folderLink($settings.drive_folder_id) : '';
  async function saveDrive() {
    if (driveEmail.trim() && !/^\S+@\S+\.\S+$/.test(driveEmail.trim())) return toast('Enter a valid Google email');
    resetDriveSession(); await setSettings({ drive_email: driveEmail.trim(), drive_client_id: clientId.trim() }); toast('Drive details saved');
  }
  async function driveNow() {
    if (!driveEmail.trim() || !clientId.trim()) return toast('Enter your Google email and Client ID first');
    await saveDrive(); driveBusy = true;
    const r = await safe(() => backupToDrive(true)); driveBusy = false;
    if (r) toast('Saved to Google Drive: ' + r.name);
  }
  async function disconnectDrive() { resetDriveSession(); await setSettings({ drive_enabled: '0' }); toast('Daily Drive backup turned off'); }
  async function loadDriveList() { driveBusy = true; const r = await safe(listDriveBackups); driveBusy = false; if (r) driveFiles = r; }
  async function restoreFromDrive(f: DriveFile) {
    const text = await safe(() => downloadDriveBackup(f.id)); if (text !== undefined) await runRestore(text, `Google Drive file "${f.name}"`);
  }
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
      try { const r = await restoreBackup(text); restoreError = ''; toast(r); }
      catch (e: any) { restoreError = (e?.message || 'Restore failed') + '\n' + detail; toast('Restore failed. See the red box below.'); }
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
  <button class="btn" on:click={save}>Save settings</button>

  <h3>Cloud sync (Firebase)</h3>
  <SyncForm />

  <h3>Product photos (Cloudinary)</h3>
  <p class="hint">Photos are uploaded to Cloudinary (free) and only a link is saved in the app, so the app stays small. Other phones on cloud sync get the same photos.</p>
  <label for="pc">Cloudinary cloud name</label><input id="pc" bind:value={photoCloud} autocapitalize="none" placeholder="e.g. dxyz123abc" />
  <label for="pp">Upload preset name (unsigned)</label><input id="pp" bind:value={photoPreset} autocapitalize="none" placeholder="e.g. provision_pos" />
  <button class="btn" on:click={savePhotoHost}>Save photo hosting</button>
  {#if $photoWaiting}<p class="hint">⏳ {$photoWaiting} photo(s) waiting to upload.</p><button class="btn alt" disabled={photoBusy} on:click={retryPhotos}>{photoBusy ? 'Uploading…' : 'Upload waiting photos now'}</button>{/if}
  {#if $settings?.photo_error}<div class="card" style="border-color:var(--er)"><b class="err">Photo upload problem</b><pre style="white-space:pre-wrap;word-break:break-word;margin:6px 0 0;font-size:.85rem">{$settings.photo_error}</pre></div>{/if}
  <details class="hint"><summary>How to get these two values (one time, about 3 minutes)</summary>
    <ol style="padding-left:18px">
      <li>Create a free account at cloudinary.com (no card needed).</li>
      <li>Your <b>cloud name</b> is shown on the dashboard / Settings › API Keys (Product environment).</li>
      <li>Settings › Upload › Upload presets › <b>Add upload preset</b>. Set <b>Signing mode: Unsigned</b>. You can set a folder (e.g. provision-pos) and allow only image formats. Save.</li>
      <li>Copy the preset's name into the box above. Menu names may differ slightly; look for “unsigned upload preset”.</li>
    </ol>
    <p>An unsigned preset needs no secret key, which is why it is safe inside the app. Anyone who learns both values could upload pictures to your account, so keep them private.</p></details>

  <h3>Google Drive backup</h3>
  <p class="hint">Backups go straight to your Google Drive (folder “Provision POS Backups”), not to the phone. Needs internet at backup time.</p>
  <label for="de">Google account email (the Drive that should receive backups)</label><input id="de" type="email" bind:value={driveEmail} placeholder="you@gmail.com" />
  <label for="ci">Google Client ID</label><input id="ci" bind:value={clientId} placeholder="123456-abc.apps.googleusercontent.com" />
  <details class="hint"><summary>How to get the Client ID (one time, about 5 minutes)</summary>
    <ol style="padding-left:18px">
      <li>Open console.cloud.google.com, create a project, and enable “Google Drive API”.</li>
      <li>APIs & Services &gt; OAuth consent screen: User type External, fill the app name, add your Drive email under “Test users”.</li>
      <li>Credentials &gt; Create credentials &gt; OAuth client ID &gt; Web application.</li>
      <li>Under “Authorized JavaScript origins” add this site's address ({location.origin}).</li>
      <li>Copy the Client ID into the box above, tap the button below, and approve. Google may say the app is unverified: choose Continue.</li>
    </ol></details>
  <button class="btn" disabled={driveBusy} on:click={driveNow}>{driveBusy ? 'Working…' : driveOn ? 'Back up to Drive now' : 'Connect Drive & back up now'}</button>
  <button class="btn alt" on:click={saveDrive}>Save Drive details</button>
  {#if driveOn}
    <p class="hint">✓ Daily backups go to Drive{$settings?.drive_last_upload ? ' · last: ' + fmtDateTime(Number($settings.drive_last_upload)) : ''}.
      {#if driveFolder}<a href={driveFolder} target="_blank" rel="noopener">Open Drive folder</a>{/if}</p>
    <button class="btn alt" on:click={disconnectDrive}>Turn off Drive backups</button>
    <button class="btn alt" disabled={driveBusy} on:click={loadDriveList}>Restore from Drive…</button>
    {#if driveFiles}{#if !driveFiles.length}<p class="hint">No backups in the Drive folder yet.</p>{/if}
      {#each driveFiles as f (f.id)}<div class="item between" style="align-items:center;cursor:default"><span>{f.name}</span><button class="sm" on:click={() => restoreFromDrive(f)}>Restore</button></div>{/each}{/if}
  {/if}

  <h3>Copies kept inside the app</h3>
  {#if !$snaps?.length}<p class="hint">None yet. The first copy is made the next time you open the app.</p>{/if}
  {#each $snaps ?? [] as sn (sn.date)}
    <div class="item between" style="align-items:center;cursor:default"><span>{sn.date === 'pre-restore' ? 'Before last restore (undo)' : sn.date}</span><button class="sm" on:click={() => restoreSnap(sn.date)}>Restore</button></div>
  {/each}
</main>

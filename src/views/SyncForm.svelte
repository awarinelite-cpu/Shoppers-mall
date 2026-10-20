<script lang="ts">
  import { liveQuery } from 'dexie';
  import { settings, toast, confirmBox } from '../lib/stores';
  import { fmtDateTime } from '../lib/money';
  import { syncStatus, syncNow, syncLabel, pendingCount, firebaseAuth, checkBeforeConnect, finishConnect, disconnectSync, parseFirebaseConfig, SyncNetworkError } from '../lib/sync';

  export let compact = false;          // shown on the first-run screen of a new phone
  let cfg = '', email = '', password = '', busy = false, problem = '';
  const pending = liveQuery(() => pendingCount());
  $: on = $settings?.sync_enabled === '1';
  $: if (on && !email) email = $settings?.sync_email ?? '';

  const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`;

  async function connect(mode: 'signin' | 'signup') {
    problem = '';
    if (!cfg.trim() || !email.trim() || !password) return (problem = 'Paste the Firebase config and enter your email and password.');
    busy = true;
    try {
      const text = JSON.stringify(parseFirebaseConfig(cfg));
      await firebaseAuth(mode, text, email, password);
      const c = await checkBeforeConnect();
      let how: 'upload' | 'download' = c.cloudHasData ? 'download' : 'upload';
      if (c.cloudHasData && c.localHasData &&
        !(await confirmBox('Use the cloud data on this phone?', 'The cloud already holds shop data, and this phone also has data. Continuing replaces what is on this phone with the cloud copy (a copy of this phone\'s data is kept inside the app under “Copies kept inside the app”). If this phone has the data you want to keep, Cancel and use a new, empty Firebase account for it.', 'Use cloud data'))) {
        await disconnectSync(); return;
      }
      await finishConnect(how, { text, email: email.trim() });
      password = '';
      if ($syncStatus.state === 'error') problem = $syncStatus.error ?? 'Sync failed';
      else toast(how === 'upload' ? 'Connected. This phone\'s data is now backed up to the cloud.' : 'Connected. Cloud data downloaded.');
    } catch (e: any) {
      problem = e instanceof SyncNetworkError ? 'No internet connection. Connect once to set up sync. After that it works offline too.' : (e?.message || 'Could not connect');
    } finally { busy = false; }
  }
  async function now() { busy = true; await syncNow(); busy = false; if ($syncStatus.state === 'error') problem = $syncStatus.error ?? ''; else problem = ''; }
  async function off() {
    if (!(await confirmBox('Turn off cloud sync?', 'This phone keeps all its data and keeps working. It stops sharing with the cloud and other phones. Anything not uploaded yet stays only on this phone.', 'Turn off'))) return;
    await disconnectSync(); toast('Cloud sync is off');
  }
  async function copyRules() { try { await navigator.clipboard.writeText(RULES); toast('Rules copied'); } catch { toast('Could not copy. Select the text and copy it.'); } }
</script>

<div class="card">
  {#if on}
    <p class="hint" style="margin-top:0">✓ Connected as <b>{$settings?.sync_email}</b> · {syncLabel($syncStatus, $pending ?? 0)}{$syncStatus.last ? ' · last sync ' + fmtDateTime($syncStatus.last) : ''}.
      Sales, stock and products made on any connected phone appear on the others. With no network this phone keeps working and catches up later.</p>
    {#if problem || $syncStatus.state === 'error'}<div class="card" style="border-color:var(--er)"><b class="err">Sync problem</b><pre style="white-space:pre-wrap;word-break:break-word;margin:6px 0 0;font-size:.85rem">{problem || $syncStatus.error}</pre></div>{/if}
    <button class="btn" disabled={busy} on:click={now}>{busy ? 'Syncing…' : 'Sync now'}</button>
    <button class="btn alt" on:click={off}>Turn off cloud sync</button>
  {:else}
    {#if !compact}<p class="hint" style="margin-top:0">Keeps a live copy of your shop in the cloud and lets several phones share one stock. Every phone still works fully offline and syncs when it has network.</p>{/if}
    <label for="fc">Firebase config (paste the whole block)</label>
    <textarea id="fc" rows="5" bind:value={cfg} placeholder={'{ apiKey: "…", authDomain: "…", projectId: "…", appId: "…" }'}></textarea>
    <label for="fe">Cloud account email</label><input id="fe" type="email" bind:value={email} autocomplete="username" />
    <label for="fp">Cloud account password</label><input id="fp" type="password" bind:value={password} autocomplete="current-password" />
    {#if problem}<div class="card" style="border-color:var(--er)"><b class="err">Could not connect</b><pre style="white-space:pre-wrap;word-break:break-word;margin:6px 0 0;font-size:.85rem">{problem}</pre></div>{/if}
    <button class="btn" disabled={busy} on:click={() => connect('signin')}>{busy ? 'Connecting…' : 'Sign in & connect'}</button>
    <button class="btn alt" disabled={busy} on:click={() => connect('signup')}>Create account & connect (first phone)</button>
    <details class="hint"><summary>One-time Firebase setup (about 5 minutes)</summary>
      <ol style="padding-left:18px">
        <li>Go to console.firebase.google.com, create a project (Analytics not needed).</li>
        <li>Project settings &gt; Your apps &gt; add a Web app (&lt;/&gt;). Copy the <b>firebaseConfig</b> block it shows and paste it above.</li>
        <li>Build &gt; Authentication &gt; Get started &gt; Sign-in method &gt; turn on <b>Email/Password</b>.</li>
        <li>Build &gt; Firestore Database &gt; Create database (production mode, pick the closest region).</li>
        <li>Firestore &gt; Rules: replace everything with the rules below and Publish. They let only your own signed-in account read or write your data.</li>
        <li>On the <b>first</b> phone tap “Create account & connect”, choosing an email and password. On every other phone use the same config and “Sign in & connect”.</li>
      </ol>
      <pre style="white-space:pre-wrap;font-size:.8rem;background:#f1f1f1;padding:8px;border-radius:8px">{RULES}</pre>
      <button class="sm" on:click={copyRules}>Copy rules</button>
    </details>
  {/if}
</div>

import { writable } from 'svelte/store';
import { db, syncBus, type Product, type Sale, type Movement } from './db';
import { getSetting, SHARED_SETTINGS, takeSnapshot } from './repo';
import { PosError } from './money';

/**
 * Cloud sync. The phone's own database stays the one the app reads and writes, so everything works with no network.
 * Changes are marked `dirty` by the database layer and uploaded here when a connection exists; changes made on other phones
 * are downloaded and merged. Merge rules (all idempotent, so repeating a sync is harmless):
 *  - sales and stock movements are never edited, so they are simply added once (matched by uid);
 *  - stock is never copied from a phone: each phone adds up the movements it receives, so two phones selling at once add up;
 *  - product details: the most recent edit wins (stock does not count as an edit);
 *  - a sale is only ever changed by a refund, and a refund wins over "completed".
 */

export type Col = 'products' | 'sales' | 'movements' | 'settings';
export interface RemoteDoc { id: string; data: any; ts: number }
export interface Remote {
  push(col: Col, docs: { id: string; data: any }[]): Promise<void>;
  /** Documents written after `since` (ms, server clock), oldest first. */
  pull(col: Col, since: number): Promise<RemoteDoc[]>;
  hasData(): Promise<boolean>;
}
export class SyncAuthError extends PosError {}
export class SyncNetworkError extends Error {}

export const OVERLAP_MS = 120_000;     // re-read the last 2 minutes on every pull: commits can become visible slightly out of order
export const COLS: Col[] = ['products', 'sales', 'movements', 'settings'];

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'error';
export const syncStatus = writable<{ state: SyncState; last?: number; error?: string }>({ state: 'off' });

let injected: Remote | null = null;
/** Tests plug a fake cloud in here. */
export const setRemote = (r: Remote | null) => { injected = r; };
let real: { key: string; remote: Remote } | null = null;

export interface FirebaseConfig { apiKey: string; projectId: string; appId: string; authDomain?: string; [k: string]: string | undefined }

/** Accepts the config exactly as the Firebase console shows it (JSON or a JavaScript object) and keeps the fields we need. */
export function parseFirebaseConfig(text: string): FirebaseConfig {
  const out: Record<string, string> = {};
  for (const k of ['apiKey', 'authDomain', 'projectId', 'appId', 'storageBucket', 'messagingSenderId']) {
    const m = text.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`));
    if (m) out[k] = m[1].trim();
  }
  const missing = ['apiKey', 'projectId', 'appId'].filter((k) => !out[k]);
  if (missing.length) throw new PosError(`The Firebase config is missing ${missing.join(', ')}. Paste the whole firebaseConfig block from the Firebase console.`);
  if (!out.authDomain) out.authDomain = out.projectId + '.firebaseapp.com';
  return out as FirebaseConfig;
}

/** Loads the Firebase code. If this page is an old version (its file was replaced by an update), reload once to get the new one. */
async function loadRemoteModule() {
  try { return await import('./firebaseRemote'); }
  catch (e) {
    let again = true; try { again = !sessionStorage.getItem('reloaded-for-update'); sessionStorage.setItem('reloaded-for-update', '1'); } catch { /* ignore */ }
    if (again && typeof location !== 'undefined') { try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* ignore */ } location.reload(); }
    throw new PosError('The app was updated. Reloading to the newest version, then tap connect again.');
  }
}

async function getRemote(): Promise<Remote> {
  if (injected) return injected;
  const text = (await getSetting('sync_config')) ?? '';
  if (!text && real) return real.remote;                  // mid-connect: signed in, config not saved yet
  if (!text) throw new PosError('Cloud sync is not set up yet. Paste your Firebase config in Settings.');
  if (real && real.key === text) return real.remote;
  const { createFirebaseRemote } = await loadRemoteModule();   // loaded only when sync is used
  real = { key: text, remote: await createFirebaseRemote(parseFirebaseConfig(text)) };
  return real.remote;
}
export async function firebaseAuth(mode: 'signin' | 'signup', configText: string, email: string, password: string) {
  const { createFirebaseRemote } = await loadRemoteModule();
  const r = await createFirebaseRemote(parseFirebaseConfig(configText)) as Remote & { signIn(m: 'signin' | 'signup', e: string, p: string): Promise<void>; signOut(): Promise<void> };
  await r.signIn(mode, email, password);
  real = { key: configText, remote: r };
}

// ---------- documents ----------
const clean = (o: any) => JSON.parse(JSON.stringify(o));     // drops undefined (Firestore rejects it), keeps null
export const productDoc = (p: Product) => { const { id, stockMilli, dirty, ...rest } = p as any; return clean(rest); };
async function saleDoc(s: Sale) {
  const { id, dirty, ...rest } = s as any;
  const items = await db.saleItems.where('saleId').equals(id).toArray();
  const pays = await db.payments.where('saleId').equals(id).toArray();
  const uids = new Map<number, string | undefined>();
  for (const i of items) if (i.productId != null && !uids.has(i.productId)) uids.set(i.productId, (await db.products.get(i.productId))?.uid);
  return clean({ ...rest,
    items: items.map(({ id: _i, saleId, productId, ...r }) => ({ ...r, productUid: productId != null ? uids.get(productId) : undefined })),
    payments: pays.map(({ id: _i, saleId, ...r }) => r) });
}
async function movementDoc(m: Movement) {
  const { id, dirty, productId, refId, ...rest } = m as any;
  return clean({ ...rest, productUid: (await db.products.get(productId))?.uid,
    refUid: refId != null ? (await db.sales.get(refId))?.uid : undefined });
}

// ---------- upload ----------
async function pushDirty(remote: Remote) {
  if ((await getSetting('shared_dirty')) === '1') {
    const values: Record<string, string> = {};
    for (const r of (await db.settings.bulkGet(SHARED_SETTINGS))) if (r) values[r.key] = r.value;
    const at = Number(await getSetting('shared_at')) || Date.now();
    await remote.push('settings', [{ id: 'shared', data: { values, at } }]);
    if (Number(await getSetting('shared_at')) === at) await db.settings.delete('shared_dirty');
  }
  const prods = await db.products.where('dirty').equals(1).toArray();
  if (prods.length) {
    const docs = prods.map((p) => ({ id: p.uid!, data: productDoc(p) }));
    await remote.push('products', docs);
    await db.transaction('rw', db.products, async () => {
      for (const [i, p] of prods.entries()) {
        const cur = await db.products.get(p.id!);       // changed again while uploading? then it stays queued
        if (cur?.dirty && JSON.stringify(productDoc(cur)) === JSON.stringify(docs[i].data)) await db.products.update(p.id!, { dirty: undefined });
      }
    });
  }
  const sales = await db.sales.where('dirty').equals(1).toArray();
  if (sales.length) {
    const docs = [];
    for (const s of sales) docs.push({ id: s.uid!, data: await saleDoc(s) });
    await remote.push('sales', docs);
    await db.transaction('rw', db.sales, async () => {
      for (const s of sales) { const cur = await db.sales.get(s.id!); if (cur?.dirty && cur.status === s.status) await db.sales.update(s.id!, { dirty: undefined }); }
    });
  }
  const movs = await db.movements.where('dirty').equals(1).toArray();     // after products and sales, so receivers already know what they refer to
  if (movs.length) {
    const docs = [];
    for (const m of movs) docs.push({ id: m.uid!, data: await movementDoc(m) });
    await remote.push('movements', docs);
    await db.transaction('rw', db.movements, async () => { for (const m of movs) await db.movements.update(m.id!, { dirty: undefined }); });
  }
}

export async function pendingCount(): Promise<number> {
  return (await db.products.where('dirty').equals(1).count()) + (await db.sales.where('dirty').equals(1).count())
    + (await db.movements.where('dirty').equals(1).count()) + ((await getSetting('shared_dirty')) === '1' ? 1 : 0);
}

// ---------- download / merge ----------
const FIELDS = ['name', 'barcode', 'altBarcode', 'internalCode', 'category', 'costKobo', 'priceKobo', 'lowThresholdMilli', 'unit', 'supplier', 'description', 'expiryAt', 'active', 'photoUrl', 'createdAt', 'updatedAt'];

/** barcode is unique on a phone. If two phones registered the same code while offline, the older product keeps it on every phone. */
async function claimBarcode(uid: string, createdAt: number, code: string | undefined): Promise<string | undefined> {
  if (!code) return undefined;
  const other = await db.products.where('barcode').equals(code).first();
  if (!other || other.uid === uid) return code;
  const incomingWins = createdAt < other.createdAt || (createdAt === other.createdAt && uid < (other.uid ?? ''));
  if (!incomingWins) return undefined;
  await db.products.update(other.id!, { barcode: undefined, dirty: other.dirty });   // keep its own upload state
  return code;
}

async function applyProducts(docs: RemoteDoc[]) {
  await db.transaction('rw', db.products, db.saleItems, async () => {
    const unlinked = (await db.saleItems.filter((i) => i.productId == null && !!i.productUid).toArray());   // sale lines waiting for their product
    for (const d of docs) {
      const r = d.data; const local = await db.products.where('uid').equals(d.id).first();
      const fields: any = {}; for (const k of FIELDS) fields[k] = r[k] ?? undefined;
      if (!local) {
        fields.barcode = await claimBarcode(d.id, r.createdAt, r.barcode);
        const pid = await db.products.add({ ...fields, uid: d.id, stockMilli: 0, metaAt: r.metaAt ?? r.updatedAt, dirty: 0 as any });
        for (const it of unlinked) if (it.productUid === d.id) await db.saleItems.update(it.id!, { productId: pid, productUid: undefined });
      } else if ((r.metaAt ?? 0) > (local.metaAt ?? 0)) {
        fields.barcode = await claimBarcode(d.id, local.createdAt, r.barcode);
        await db.products.update(local.id!, { ...fields, createdAt: local.createdAt, metaAt: r.metaAt, dirty: undefined });
      }
    }
  });
}

async function applySales(docs: RemoteDoc[]) {
  await db.transaction('rw', [db.sales, db.saleItems, db.payments, db.products], async () => {
    for (const d of docs) {
      const r = d.data; const local = await db.sales.where('uid').equals(d.id).first();
      if (local) {
        if (r.status === 'REFUNDED' && local.status !== 'REFUNDED')
          await db.sales.update(local.id!, { status: 'REFUNDED', refundedAt: r.refundedAt, refundReason: r.refundReason, dirty: undefined });
        continue;
      }
      if (await db.sales.where('clientToken').equals(r.clientToken).count()) continue;
      const { items, payments, ...s } = r;
      if (await db.sales.where('receiptNo').equals(s.receiptNo).count()) s.receiptNo = `${s.receiptNo}~${d.id.slice(0, 4)}`;   // two phones picked the same number
      const saleId = await db.sales.add({ ...s, uid: d.id, dirty: 0 as any });
      for (const { productUid, ...it } of items ?? []) {
        const p = productUid ? await db.products.where('uid').equals(productUid).first() : undefined;
        await db.saleItems.add({ ...it, saleId, productId: p?.id, productUid: p ? undefined : productUid });
      }
      if (payments?.length) await db.payments.bulkAdd(payments.map((p: any) => ({ ...p, saleId })));
    }
  });
}

/** Returns the time before which everything was handled; movements whose product has not arrived yet are left to the next round. */
async function applyMovements(docs: RemoteDoc[]): Promise<number | undefined> {
  let blocked: number | undefined;
  await db.transaction('rw', [db.movements, db.products, db.sales], async () => {
    for (const d of docs) {
      if (await db.movements.where('uid').equals(d.id).count()) continue;
      const r = d.data; const p = r.productUid ? await db.products.where('uid').equals(r.productUid).first() : undefined;
      if (!p) { blocked = Math.min(blocked ?? d.ts, d.ts); continue; }
      const sale = r.refUid ? await db.sales.where('uid').equals(r.refUid).first() : undefined;
      const { productUid, refUid, ...m } = r;
      await db.movements.add({ ...m, productId: p.id!, refId: sale?.id, prevMilli: p.stockMilli, newMilli: p.stockMilli + r.changeMilli, uid: d.id, dirty: 0 as any });
      await db.products.update(p.id!, { stockMilli: p.stockMilli + r.changeMilli });      // stock = sum of movements, so concurrent sales add up
    }
  });
  return blocked;
}

async function applySettings(docs: RemoteDoc[]) {
  for (const d of docs) {
    const at = Number(d.data?.at) || 0, mine = Number(await getSetting('shared_at')) || 0;
    if (d.id !== 'shared' || at <= mine) continue;
    const rows = Object.entries(d.data.values ?? {}).filter(([k]) => SHARED_SETTINGS.includes(k)).map(([key, value]) => ({ key, value: String(value) }));
    await db.settings.bulkPut([...rows, { key: 'shared_at', value: String(at) }]);
    if ((await getSetting('shared_dirty')) === '1') await db.settings.delete('shared_dirty');
  }
}

async function pullAll(remote: Remote) {
  for (const col of COLS) {
    const key = 'sync_cur_' + col, cur = Number(await getSetting(key)) || 0;
    const docs = await remote.pull(col, Math.max(0, cur - OVERLAP_MS));
    if (!docs.length) continue;
    let blocked: number | undefined;
    if (col === 'products') await applyProducts(docs);
    else if (col === 'sales') await applySales(docs);
    else if (col === 'movements') blocked = await applyMovements(docs);
    else await applySettings(docs);
    const max = Math.max(cur, ...docs.map((d) => d.ts));
    await db.settings.put({ key, value: String(blocked !== undefined ? Math.min(max, blocked - 1) : max) });
  }
}

// ---------- running a sync ----------
let running: Promise<void> | null = null, again = false;
const isNetwork = (e: any) => e instanceof SyncNetworkError || (typeof navigator !== 'undefined' && navigator.onLine === false);

/** Upload what is waiting, then download what others did. Safe to call at any time and as often as you like. */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      if ((await getSetting('sync_enabled')) !== '1') { syncStatus.set({ state: 'off' }); return; }
      syncStatus.update((s) => ({ ...s, state: 'syncing', error: undefined }));
      const remote = await getRemote();
      await pushDirty(remote);
      await pullAll(remote);
      const last = Date.now(); await db.settings.bulkPut([{ key: 'sync_last', value: String(last) }, { key: 'sync_error', value: '' }]);
      syncStatus.set({ state: 'idle', last });
    } catch (e: any) {
      if (isNetwork(e)) syncStatus.update((s) => ({ ...s, state: 'offline', error: undefined }));
      else { const msg = e?.message ?? 'Sync failed'; await db.settings.put({ key: 'sync_error', value: msg }).catch(() => {}); syncStatus.update((s) => ({ ...s, state: 'error', error: msg })); }
    } finally {
      running = null;
      if (again) { again = false; setTimeout(() => { syncNow(); }, 500); }
    }
  })();
  return running;
}

let timer: ReturnType<typeof setInterval> | undefined, soon: ReturnType<typeof setTimeout> | undefined, started = false;
export function syncSoon(ms = 3000) { clearTimeout(soon); soon = setTimeout(() => { syncNow(); }, ms); }

/** Call once when the app opens. Does nothing until the person has connected cloud sync. */
export async function startAutoSync() {
  const enabled = (await getSetting('sync_enabled')) === '1';
  if (!enabled) { syncStatus.set({ state: 'off' }); return; }
  const last = Number(await getSetting('sync_last')) || undefined, err = (await getSetting('sync_error')) || undefined;
  syncStatus.set({ state: err ? 'error' : 'idle', last, error: err });
  syncBus.kick = () => syncSoon();
  if (!started && typeof window !== 'undefined') {
    started = true;
    window.addEventListener('online', () => syncNow());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    timer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 90_000);
  }
  syncNow();
}
export function stopAutoSync() { syncBus.kick = null; clearInterval(timer); clearTimeout(soon); started = false; }

// ---------- connecting ----------
export interface ConnectCheck { cloudHasData: boolean; localHasData: boolean }

/** After signing in: what is on the cloud and on this phone? (nothing is changed yet) */
export async function checkBeforeConnect(): Promise<ConnectCheck> {
  const remote = await getRemote();
  return { cloudHasData: await remote.hasData(), localHasData: (await db.products.count()) > 0 || (await db.sales.count()) > 0 };
}

const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

/**
 * 'upload': the cloud is empty, so this phone's data becomes the cloud copy.
 * 'download': the cloud copy replaces this phone's data (a copy of the old data is kept inside the app first).
 */
export async function finishConnect(mode: 'upload' | 'download', config: { text: string; email: string }) {
  if (mode === 'download') {
    if ((await db.products.count()) + (await db.sales.count())) await takeSnapshot('before-sync');
    await db.transaction('rw', [db.products, db.sales, db.saleItems, db.payments, db.movements, db.settings, db.photoQueue], async () => {
      await Promise.all([db.products.clear(), db.sales.clear(), db.saleItems.clear(), db.payments.clear(), db.movements.clear(), db.photoQueue.clear()]);
      await db.settings.bulkDelete([...COLS.map((c) => 'sync_cur_' + c), 'shared_at', 'shared_dirty', 'receipt_counter']);
    });
  } else {
    await reconcileStock();
    await db.products.toCollection().modify({ dirty: 1 });
    await db.sales.toCollection().modify({ dirty: 1 });
    await db.movements.toCollection().modify({ dirty: 1 });
    await db.settings.bulkPut([{ key: 'shared_at', value: String(Date.now()) }, { key: 'shared_dirty', value: '1' }]);
  }
  const code = (await getSetting('device_code')) || randomCode();
  await db.settings.bulkPut([{ key: 'sync_enabled', value: '1' }, { key: 'sync_config', value: config.text }, { key: 'sync_email', value: config.email }, { key: 'device_code', value: code }, { key: 'sync_error', value: '' }]);
  await startAutoSync();
  await running;
}

/** Other phones compute stock by adding up movements, so each product's movements must add up to its stock. Records any gap as one movement. */
export async function reconcileStock() {
  await db.transaction('rw', [db.products, db.movements], async () => {
    const sums = new Map<number, number>();
    await db.movements.each((m) => sums.set(m.productId, (sums.get(m.productId) ?? 0) + m.changeMilli));
    for (const p of await db.products.toArray()) {
      const sum = sums.get(p.id!) ?? 0, diff = p.stockMilli - sum;
      if (diff) await db.movements.add({ productId: p.id!, productName: p.name, type: 'ADJUSTMENT', changeMilli: diff, prevMilli: sum, newMilli: p.stockMilli, reason: 'Cloud sync baseline', createdAt: Date.now() });
    }
  });
}

export async function disconnectSync() {
  stopAutoSync();
  await db.settings.bulkPut([{ key: 'sync_enabled', value: '0' }, { key: 'sync_error', value: '' }]);
  const r: any = real?.remote; real = null; try { await r?.signOut?.(); } catch { /* ignore */ }
  syncStatus.set({ state: 'off' });
}

export interface SyncInfo { state: SyncState; last?: number; error?: string }
export const syncLabel = (s: SyncInfo, pending: number) =>
  s.state === 'off' ? '' : s.state === 'syncing' ? 'Syncing…' : s.state === 'offline' ? (pending ? `Offline · ${pending} waiting to upload` : 'Offline')
    : s.state === 'error' ? 'Sync problem' : pending ? `${pending} waiting to upload` : 'Synced';

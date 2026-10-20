import { db, type Product, type Sale, type SaleItem, type Payment, type Movement } from './db';
import { PosError, lineTotal, totals, settle, fmtDate, fmtQty, type PayIn } from './money';

const now = () => Date.now();

// ---------- settings ----------
export const getSetting = async (k: string) => (await db.settings.get(k))?.value;
/** Settings shared by every phone on the same cloud account. Other keys (cashier name, Drive link, counters) stay per phone. */
export const SHARED_SETTINGS = ['store_name', 'address', 'phone', 'footer', 'receipt_prefix', 'low_default', 'tax_bps', 'default_pay', 'allow_negative', 'setup_done', 'photo_cloud', 'photo_preset'];
export async function setSettings(m: Record<string, string>) {
  const entries = Object.entries(m).map(([key, value]) => ({ key, value }));
  const mine = (await db.settings.bulkGet(SHARED_SETTINGS)).filter(Boolean);
  const changed = entries.some((e) => SHARED_SETTINGS.includes(e.key) && mine.find((x) => x!.key === e.key)?.value !== e.value);
  if (changed) entries.push({ key: 'shared_at', value: String(now()) }, { key: 'shared_dirty', value: '1' });
  return db.settings.bulkPut(entries);
}

// ---------- products ----------
export async function findByCode(code: string): Promise<Product | undefined> {
  const c = code.trim(); if (!c) return undefined;
  return (await db.products.where('barcode').equals(c).first()) ?? (await db.products.where('altBarcode').equals(c).first())
    ?? (await db.products.where('internalCode').equals(c).first());
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'internalCode' | 'active'> & { id?: number; internalCode?: string };

export function saveProduct(p: ProductInput): Promise<number> {
  return db.transaction('rw', db.products, db.movements, async () => {
    if (!p.name.trim()) throw new PosError('Product name is required');
    if (!(p.priceKobo >= 0)) throw new PosError('Selling price cannot be negative');
    if (p.costKobo != null && p.costKobo < 0) throw new PosError('Purchase cost cannot be negative');
    if (p.stockMilli < 0 || p.lowThresholdMilli < 0) throw new PosError('Quantities cannot be negative');
    const barcode = p.barcode?.trim() || undefined, altBarcode = p.altBarcode?.trim() || undefined;
    if (barcode && barcode === altBarcode) throw new PosError('Alternative barcode must differ from the barcode');
    for (const c of [barcode, altBarcode]) if (c) {
      const other = await findByCode(c);
      if (other && other.id !== p.id) throw new PosError(`Barcode ${c} already belongs to "${other.name}"`);
    }
    const t = now();
    const base = { ...p, name: p.name.trim(), barcode, altBarcode };
    if (!p.id) {
      const id = await db.products.add({ ...base, internalCode: 'TMP' + t, active: true, createdAt: t, updatedAt: t } as Product);
      await db.products.update(id, { internalCode: p.internalCode?.trim() || 'P' + String(id).padStart(5, '0') });
      if (p.stockMilli > 0) await db.movements.add({ productId: id, productName: base.name, type: 'OPENING', changeMilli: p.stockMilli, prevMilli: 0, newMilli: p.stockMilli, reason: 'Opening stock', createdAt: t });
      return id;
    }
    const ex = await db.products.get(p.id); if (!ex) throw new PosError('Product not found');
    // stock changes only through adjustments and sales
    await db.products.put({ ...ex, ...base, id: p.id, stockMilli: ex.stockMilli, createdAt: ex.createdAt, active: ex.active,
      internalCode: p.internalCode?.trim() || ex.internalCode, updatedAt: t } as Product);
    return p.id;
  });
}

export const setActive = (id: number, active: boolean) => db.products.update(id, { active, updatedAt: now() });

export function adjustStock(pid: number, deltaMilli: number, type: string, reason: string, note?: string, newCost?: number | null) {
  return db.transaction('rw', db.products, db.movements, async () => {
    const p = await db.products.get(pid); if (!p) throw new PosError('Product not found');
    if (!deltaMilli) throw new PosError('Enter a quantity');
    const nq = p.stockMilli + deltaMilli;
    if (nq < 0) throw new PosError(`Cannot remove more than the ${fmtQty(p.stockMilli)} in stock`);
    const t = now();
    await db.products.update(pid, { stockMilli: nq, costKobo: newCost ?? p.costKobo, updatedAt: t });
    await db.movements.add({ productId: pid, productName: p.name, type, changeMilli: deltaMilli, prevMilli: p.stockMilli, newMilli: nq, reason, note: note || undefined, createdAt: t });
  });
}

// ---------- sales ----------
export interface SaleRequest { token: string; lines: { productId: number; qtyMilli: number }[]; discountKobo: number; payments: PayIn[]; cashier: string; expectedTotal: number }

/** One atomic transaction: any thrown error rolls back the sale, receipt number and stock changes together. */
export function completeSale(req: SaleRequest): Promise<Sale> {
  return db.transaction('rw', [db.products, db.sales, db.saleItems, db.payments, db.movements, db.settings], async () => {
    const existing = await db.sales.where('clientToken').equals(req.token).first();
    if (existing) return existing;                       // idempotent against double taps / retries
    if (!req.lines.length) throw new PosError('The cart is empty');
    const allowNeg = true;   // selling at zero/low stock is always allowed
    const taxBps = parseInt((await getSetting('tax_bps')) ?? '0') || 0;
    const t = now();
    const fresh: { p: Product; q: number }[] = [];
    for (const l of req.lines) {
      const p = await db.products.get(l.productId);
      if (!p) throw new PosError('A product in the cart no longer exists');
      if (!p.active) throw new PosError(`${p.name} has been deactivated. Remove it from the cart.`);
      if (!(l.qtyMilli > 0)) throw new PosError(`Invalid quantity for ${p.name}`);
      if (!allowNeg && p.stockMilli < l.qtyMilli) throw new PosError(`Not enough stock for ${p.name}: ${fmtQty(p.stockMilli)} available`);
      fresh.push({ p, q: l.qtyMilli });
    }
    const lt = fresh.map(({ p, q }) => lineTotal(p.priceKobo, q));
    const tot = totals(lt, req.discountKobo, taxBps);
    if (tot.total !== req.expectedTotal) throw new PosError('Prices changed since the cart was built. Review the cart.');
    const st = settle(tot.total, req.payments);
    const counter = (parseInt((await getSetting('receipt_counter')) ?? '0') || 0) + 1;
    await db.settings.put({ key: 'receipt_counter', value: String(counter) });
    const prefix = (await getSetting('receipt_prefix')) || 'POS';
    const dc = await getSetting('device_code');            // present once cloud sync was set up: keeps receipt numbers of different phones apart
    const receiptNo = `${prefix}-${dc ? dc + '-' : ''}${String(counter).padStart(6, '0')}`;
    const sale: Sale = { receiptNo, clientToken: req.token, createdAt: t, subtotal: tot.subtotal, discount: tot.discount, tax: tot.tax, total: tot.total,
      tendered: st.tendered, changeDue: st.change, status: 'COMPLETED', paymentStatus: 'PAID',
      methods: [...new Set(st.applied.map((a) => a.method))].join(','), cashier: req.cashier };
    const saleId = await db.sales.add(sale); sale.id = saleId;
    for (let i = 0; i < fresh.length; i++) {
      const { p, q } = fresh[i];
      await db.products.update(p.id!, { stockMilli: p.stockMilli - q, updatedAt: t });
      await db.movements.add({ productId: p.id!, productName: p.name, type: 'SALE', changeMilli: -q, prevMilli: p.stockMilli, newMilli: p.stockMilli - q, reason: `Sale ${receiptNo}`, refId: saleId, createdAt: t });
      await db.saleItems.add({ saleId, productId: p.id, productName: p.name, barcode: p.barcode, category: p.category, unit: p.unit, qtyMilli: q,
        unitPriceKobo: p.priceKobo, unitCostKobo: p.costKobo, lineTotalKobo: lt[i] });
    }
    await db.payments.bulkAdd(st.applied.map((a) => ({ saleId, method: a.method, amountKobo: a.amount, createdAt: t, status: 'RECEIVED' })));
    return sale;
  });
}

export async function saleDetail(id: number): Promise<{ sale: Sale; items: SaleItem[]; payments: Payment[] } | undefined> {
  const sale = await db.sales.get(id); if (!sale) return undefined;
  return { sale, items: await db.saleItems.where('saleId').equals(id).toArray(), payments: await db.payments.where('saleId').equals(id).toArray() };
}

/** Full reversal. The sale stays in history marked REFUNDED; stock is restored through movements. */
export function refund(id: number, reason: string) {
  return db.transaction('rw', [db.products, db.sales, db.saleItems, db.movements], async () => {
    const s = await db.sales.get(id); if (!s) throw new PosError('Sale not found');
    if (s.status !== 'COMPLETED') throw new PosError('This sale was already refunded');
    const t = now();
    for (const it of await db.saleItems.where('saleId').equals(id).toArray()) {
      const p = it.productId != null ? await db.products.get(it.productId) : undefined; if (!p) continue;
      await db.products.update(p.id!, { stockMilli: p.stockMilli + it.qtyMilli, updatedAt: t });
      await db.movements.add({ productId: p.id!, productName: p.name, type: 'REFUND', changeMilli: it.qtyMilli, prevMilli: p.stockMilli,
        newMilli: p.stockMilli + it.qtyMilli, reason: `Refund ${s.receiptNo}`, note: reason || undefined, refId: id, createdAt: t,
        uid: `refund-${s.uid}-${p.uid}` });   // same id on every phone: a refund done on two phones restores stock once
    }
    await db.sales.update(id, { status: 'REFUNDED', refundedAt: t, refundReason: reason || undefined });
  });
}

// ---------- reports ----------
export interface Report {
  from: number; to: number; saleCount: number; totalSales: number; netSales: number; discount: number; tax: number; itemsMilli: number; avgSale: number;
  byMethod: Record<string, number>; byProduct: { name: string; category: string; qtyMilli: number; revenue: number }[];
  byCategory: Record<string, number>; trend: [string, number][]; cogs: number; uncostedLines: number; grossProfit: number | null;
  refundedCount: number; refundedTotal: number;
}
export async function report(from: number, to: number): Promise<Report> {
  const all = await db.sales.where('createdAt').between(from, to, true, true).toArray();
  const done = all.filter((s) => s.status === 'COMPLETED'), refunded = all.filter((s) => s.status === 'REFUNDED');
  const ids = done.map((s) => s.id!);
  const items = ids.length ? await db.saleItems.where('saleId').anyOf(ids).toArray() : [];
  const pays = ids.length ? await db.payments.where('saleId').anyOf(ids).toArray() : [];
  const costed = items.filter((i) => i.unitCostKobo != null);
  const cogs = costed.reduce((a, i) => a + lineTotal(i.unitCostKobo!, i.qtyMilli), 0);
  const uncosted = items.length - costed.length;
  const net = done.reduce((a, s) => a + s.subtotal - s.discount, 0);
  const total = done.reduce((a, s) => a + s.total, 0);
  const byMethod: Record<string, number> = {}; pays.forEach((p) => (byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountKobo));
  const prod = new Map<string, { name: string; category: string; qtyMilli: number; revenue: number }>();
  items.forEach((i) => { const k = i.productName + '|' + i.category; const e = prod.get(k) ?? { name: i.productName, category: i.category, qtyMilli: 0, revenue: 0 };
    e.qtyMilli += i.qtyMilli; e.revenue += i.lineTotalKobo; prod.set(k, e); });
  const byCategory: Record<string, number> = {}; items.forEach((i) => { const c = i.category || 'Uncategorised'; byCategory[c] = (byCategory[c] ?? 0) + i.lineTotalKobo; });
  const tr = new Map<string, number>(); done.forEach((s) => { const d = fmtDate(s.createdAt); tr.set(d, (tr.get(d) ?? 0) + s.total); });
  return { from, to, saleCount: done.length, totalSales: total, netSales: net, discount: done.reduce((a, s) => a + s.discount, 0), tax: done.reduce((a, s) => a + s.tax, 0),
    itemsMilli: items.reduce((a, i) => a + i.qtyMilli, 0), avgSale: done.length ? Math.floor(total / done.length) : 0, byMethod,
    byProduct: [...prod.values()].sort((a, b) => b.revenue - a.revenue), byCategory, trend: [...tr.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    cogs, uncostedLines: uncosted, grossProfit: uncosted === 0 ? net - cogs : null, refundedCount: refunded.length, refundedTotal: refunded.reduce((a, s) => a + s.total, 0) };
}

// Owner PIN was removed from the app. Older installs may still hold a stored PIN hash; clear it.
export const removeLegacyPin = () => db.settings.bulkDelete(['pin_hash', 'pin_salt']);

// ---------- backup / restore ----------
export async function exportBackup(): Promise<string> {
  const clean = <T extends { dirty?: unknown }>(rows: T[]) => rows.map(({ dirty, ...r }) => r);
  return JSON.stringify({ format: 'provision-pos-backup', version: 1, createdAt: now(), products: clean(await db.products.toArray()), sales: clean(await db.sales.toArray()),
    saleItems: await db.saleItems.toArray(), payments: await db.payments.toArray(), movements: clean(await db.movements.toArray()), settings: await db.settings.toArray() });
}

/** Validates, then replaces all data in one transaction. Nothing changes if anything fails. */
export async function restoreBackup(json: string): Promise<string> {
  if ((await getSetting('sync_enabled')) === '1')
    throw new PosError('Cloud sync is on, and the cloud already holds your data. Restoring a file here would clash with it. To get your data back on a phone, use Settings > Cloud sync (it downloads everything). To restore a file anyway, turn cloud sync off first.');
  let b: any;
  const text = json.replace(/^\uFEFF/, '').trim();
  if (!text) throw new PosError('The file is empty (0 bytes). The backup was not saved properly. Export it again.');
  if (text.startsWith('<')) throw new PosError('That file is a web page, not a backup. Export the backup again and pick the .json file from your Downloads.');
  try { b = JSON.parse(text); if (typeof b === 'string') b = JSON.parse(b); }   // also accepts double-encoded text
  catch { throw new PosError('That file is not readable as a backup (it may be cut off or edited). Pick the .json file exported from Provision POS, not a CSV report or receipt.'); }
  const arr = (k: string) => b && Array.isArray(b[k]);
  if (!b || typeof b !== 'object' || (b.format !== 'provision-pos-backup' && !(arr('products') && arr('sales'))))
    throw new PosError(`This is not a Provision POS backup file (it contains: ${b && typeof b === 'object' ? Object.keys(b).slice(0, 6).join(', ') || 'nothing' : typeof b}).`);
  const ver = b.version ?? 1;
  if (ver > 1) throw new PosError(`Backup was made by a newer app version (v${ver}). Update the app first.`);
  for (const k of ['products', 'sales', 'saleItems', 'payments', 'movements', 'settings']) if (!arr(k)) throw new PosError(`Backup is incomplete: "${k}" is missing`);
  const pids = new Set<number>(b.products.map((p: Product) => p.id)), sids = new Set<number>(b.sales.map((s: Sale) => s.id));
  if (pids.size !== b.products.length || sids.size !== b.sales.length) throw new PosError('Backup contains duplicate records');
  if (new Set(b.sales.map((s: Sale) => s.receiptNo)).size !== b.sales.length) throw new PosError('Backup contains duplicate receipt numbers');
  if (b.saleItems.some((i: SaleItem) => !sids.has(i.saleId)) || b.payments.some((p: Payment) => !sids.has(p.saleId))) throw new PosError('Backup is inconsistent (items without a sale)');
  if (b.movements.some((m: Movement) => !pids.has(m.productId))) throw new PosError('Backup is inconsistent (stock movement without a product)');
  await takeSnapshot('pre-restore');       // undo point: the data being replaced
  const keep = (await db.settings.toArray()).filter((x) => /^(drive_|sync_|device_)/.test(x.key) && x.value);   // this phone's Drive link and sync link survive a restore
  await db.transaction('rw', [db.products, db.sales, db.saleItems, db.payments, db.movements, db.settings, db.photoQueue], async () => {
    await Promise.all([db.products.clear(), db.sales.clear(), db.saleItems.clear(), db.payments.clear(), db.movements.clear(), db.settings.clear(), db.photoQueue.clear()]);
    await db.products.bulkAdd(b.products); await db.sales.bulkAdd(b.sales); await db.saleItems.bulkAdd(b.saleItems);
    await db.payments.bulkAdd(b.payments); await db.movements.bulkAdd(b.movements); await db.settings.bulkAdd(b.settings);
    const c = Math.max(parseInt(b.settings.find((s: any) => s.key === 'receipt_counter')?.value ?? '0') || 0, b.sales.length);
    await db.settings.put({ key: 'receipt_counter', value: String(c) });
    if (keep.length) await db.settings.bulkPut(keep);
  });
  return `Restored ${b.products.length} products and ${b.sales.length} sales`;
}

// ---------- automatic snapshots (kept inside the app) ----------
export const takeSnapshot = async (key: string) => { await db.snapshots.put({ date: key, createdAt: now(), json: await exportBackup() }); };
const hasData = async () => (await db.products.count()) > 0 || (await db.sales.count()) > 0;

/** Once per calendar day, on first open: keep an in-app copy; the last 7 days are retained. */
export async function dailySnapshot() {
  if (!(await hasData())) return;
  const key = fmtDate(now());
  if (await db.snapshots.get(key)) return;
  await takeSnapshot(key);
  const days = (await db.snapshots.orderBy('date').toArray()).filter((s) => s.date !== 'pre-restore');
  await db.snapshots.bulkDelete(days.slice(0, -7).map((s) => s.date));
}
export const listSnapshots = () => db.snapshots.orderBy('date').reverse().toArray();
export async function restoreSnapshot(key: string) {
  const s = await db.snapshots.get(key); if (!s) throw new PosError('Snapshot not found');
  return restoreBackup(s.json);
}

/** True when a backup FILE should be downloaded now: auto-backup is on and none was downloaded today. */
export async function dueDailyDownload(): Promise<boolean> {
  if ((await getSetting('auto_backup')) === '0' || !(await hasData())) return false;
  return (await getSetting('last_auto_download')) !== fmtDate(now());
}
export const markDailyDownload = () => setSettings({ last_auto_download: fmtDate(now()), last_backup: String(now()) });

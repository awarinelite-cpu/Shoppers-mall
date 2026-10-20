import { describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';

// ---- a fake cloud shared by several simulated phones ----
class Cloud {
  cols: Record<string, Map<string, { data: any; ts: number }>> = { products: new Map(), sales: new Map(), movements: new Map(), settings: new Map() };
  clock = 1_000_000; offline = false; pushes = 0;
  remote(net: new (m: string) => Error) {
    const check = () => { if (this.offline) throw new net('offline'); };
    return {
      push: async (col: string, docs: { id: string; data: any }[]) => { check(); this.pushes++; this.clock += 1000; for (const d of docs) this.cols[col].set(d.id, { data: JSON.parse(JSON.stringify(d.data)), ts: this.clock }); },
      pull: async (col: string, since: number) => { check(); return [...this.cols[col]].filter(([, v]) => v.ts > since).sort((a, b) => a[1].ts - b[1].ts).map(([id, v]) => ({ id, data: JSON.parse(JSON.stringify(v.data)), ts: v.ts })); },
      hasData: async () => { check(); return ['products', 'sales', 'movements'].some((c) => this.cols[c].size > 0); }
    };
  }
}

let n = 0;
/** One simulated phone: its own IndexedDB and its own copy of the app code. */
async function phone(cloud: Cloud, name?: string) {
  vi.resetModules();
  (globalThis as any).__POS_DB_NAME__ = name ?? `phone-${++n}-${Math.random()}`;
  const db = await import('./db'), repo = await import('./repo'), sync = await import('./sync');
  sync.setRemote(cloud.remote(sync.SyncNetworkError) as any);
  const mk = (nm: string, barcode: string | undefined, price: number, stock: number) =>
    repo.saveProduct({ name: nm, barcode, category: 'T', costKobo: 30000, priceKobo: price, stockMilli: stock, lowThresholdMilli: 1000, unit: 'PIECE' });
  const sell = (token: string, pid: number, qty: number, total: number) =>
    repo.completeSale({ token, lines: [{ productId: pid, qtyMilli: qty }], discountKobo: 0, payments: [{ method: 'CASH', amount: total }], cashier: 'T', expectedTotal: total });
  const byName = async (nm: string) => (await db.db.products.filter((p) => p.name === nm).first())!;
  return { db: db.db, repo, sync, mk, sell, byName, connect: (mode: 'upload' | 'download') => sync.finishConnect(mode, { text: 'cfg', email: 'o@x.com' }) };
}

describe('database v3 upgrade', () => {
  it('gives existing records a uid and marks them for upload', async () => {
    const old: any = new Dexie('old-phone');
    old.version(1).stores({ products: '++id,&barcode,altBarcode,name,internalCode,category', sales: '++id,&receiptNo,&clientToken,createdAt', saleItems: '++id,saleId,productId', payments: '++id,saleId', movements: '++id,productId,createdAt', settings: 'key' });
    old.version(2).stores({ snapshots: 'date' });
    await old.products.add({ name: 'Old', internalCode: 'P1', category: 'x', priceKobo: 100, stockMilli: 1000, lowThresholdMilli: 0, unit: 'PIECE', active: true, createdAt: 5, updatedAt: 7, costKobo: null });
    await old.movements.add({ productId: 1, productName: 'Old', type: 'OPENING', changeMilli: 1000, prevMilli: 0, newMilli: 1000, reason: 'x', createdAt: 5 });
    old.close();
    vi.resetModules(); (globalThis as any).__POS_DB_NAME__ = 'old-phone';
    const { db } = await import('./db');
    const p = await db.products.toCollection().first();
    expect(p!.uid).toMatch(/^[0-9a-f-]{36}$/); expect(p!.dirty).toBe(1); expect(p!.metaAt).toBe(7); expect(p!.name).toBe('Old');
    expect((await db.movements.toCollection().first())!.uid).toBeTruthy();
  });
});

describe('what gets marked for upload', () => {
  it('stock-only changes do not re-upload a product; detail edits and refunds do', async () => {
    const A = await phone(new Cloud()); await A.connect('upload'); await A.sync.syncNow();
    const id = await A.mk('Rice', '1', 100000, 10000); await A.sync.syncNow();
    expect(await A.sync.pendingCount()).toBe(0);
    const s = await A.sell('t', id, 1000, 100000);
    expect((await A.db.products.get(id))!.dirty).toBeUndefined();     // stock changed, details did not
    expect(await A.db.sales.where('dirty').equals(1).count()).toBe(1);
    await A.sync.syncNow(); expect(await A.sync.pendingCount()).toBe(0);
    await A.repo.refund(s.id!, 'x'); expect((await A.db.sales.get(s.id!))!.dirty).toBe(1);
    await A.sync.syncNow();
    await A.repo.saveProduct({ ...(await A.db.products.get(id))!, priceKobo: 120000 }); expect((await A.db.products.get(id))!.dirty).toBe(1);
  });
  it('backup files do not contain the upload marker', async () => {
    const A = await phone(new Cloud()); await A.mk('Rice', '1', 100000, 10000);
    const b = JSON.parse(await A.repo.exportBackup());
    expect(b.products[0].dirty).toBeUndefined(); expect(b.products[0].uid).toBeTruthy();
  });
});

describe('two phones, one cloud', () => {
  it('a new phone downloads products, stock, sales, refunds and settings', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); await A.repo.setSettings({ store_name: 'APAA', low_default: '3', setup_done: '1', cashier: 'Amaka' });
    const id = await A.mk('Indomie', '111', 50000, 10000); const id2 = await A.mk('Milo', '222', 90000, 5000);
    const s1 = await A.sell('t1', id, 3000, 150000); await A.sell('t2', id2, 1000, 90000); await A.repo.refund(s1.id!, 'wrong item');
    await A.connect('upload');
    const B = await phone(cloud);
    expect(await B.sync.checkBeforeConnect()).toEqual({ cloudHasData: true, localHasData: false });
    await B.connect('download');
    expect((await B.byName('Indomie')).stockMilli).toBe(10000);      // 10 opening - 3 sold + 3 refunded
    expect((await B.byName('Milo')).stockMilli).toBe(4000);
    expect(await B.db.sales.count()).toBe(2);
    const refunded = (await B.db.sales.toArray()).find((s) => s.status === 'REFUNDED')!;
    expect(refunded.total).toBe(150000);
    expect((await B.db.saleItems.where('saleId').equals(refunded.id!).first())!.productId).toBe((await B.byName('Indomie')).id);
    expect(await B.db.payments.count()).toBe(2);
    expect((await B.repo.getSetting('store_name'))).toBe('APAA'); expect(await B.repo.getSetting('low_default')).toBe('3'); expect(await B.repo.getSetting('setup_done')).toBe('1');
    expect(await B.repo.getSetting('cashier')).toBeUndefined();      // per-phone setting stays on its phone
    expect(await B.sync.pendingCount()).toBe(0);
  });

  it('both phones selling the same product at once: stock adds up on both', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); await A.mk('Rice', '1', 100000, 10000); await A.connect('upload');
    const B = await phone(cloud); await B.connect('download');
    const a = (await A.byName('Rice')).id!, b = (await B.byName('Rice')).id!;
    await A.sell('a1', a, 2000, 200000); await B.sell('b1', b, 3000, 300000);        // both offline from each other
    await A.sync.syncNow(); await B.sync.syncNow(); await A.sync.syncNow();
    expect((await A.byName('Rice')).stockMilli).toBe(5000); expect((await B.byName('Rice')).stockMilli).toBe(5000);
    expect(await A.db.sales.count()).toBe(2); expect(await B.db.sales.count()).toBe(2);
    const rn = [...(await A.db.sales.toArray()), ...(await B.db.sales.toArray())].map((s) => s.receiptNo);
    expect(new Set(rn).size).toBe(2);                                               // receipt numbers do not clash across phones
    expect(rn[0]).toMatch(/^POS-[A-Z2-9]{3}-\d{6}$/);
  });

  it('the same sale refunded on both phones restores stock once', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); const id = await A.mk('Rice', '1', 100000, 10000); const s = await A.sell('s', id, 4000, 400000); await A.connect('upload');
    const B = await phone(cloud); await B.connect('download');
    await A.repo.refund(s.id!, 'a'); await B.repo.refund((await B.db.sales.toCollection().first())!.id!, 'b');
    await A.sync.syncNow(); await B.sync.syncNow(); await A.sync.syncNow();
    expect((await A.byName('Rice')).stockMilli).toBe(10000); expect((await B.byName('Rice')).stockMilli).toBe(10000);
    expect((await A.db.sales.toCollection().first())!.status).toBe('REFUNDED'); expect((await B.db.sales.toCollection().first())!.status).toBe('REFUNDED');
    expect((await A.db.movements.toArray()).filter((m) => m.type === 'REFUND').length).toBe(1);
  });

  it('latest product edit wins, and selling never overwrites a price change made elsewhere', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); await A.mk('Rice', '1', 100000, 10000); await A.connect('upload');
    const B = await phone(cloud); await B.connect('download');
    await new Promise((r) => setTimeout(r, 5));
    await B.repo.saveProduct({ ...(await B.byName('Rice')), priceKobo: 120000 }); await B.sync.syncNow();
    await A.sell('a1', (await A.byName('Rice')).id!, 1000, 100000);                  // A still has the old price and sells
    await A.sync.syncNow(); await B.sync.syncNow();
    expect((await A.byName('Rice')).priceKobo).toBe(120000); expect((await B.byName('Rice')).priceKobo).toBe(120000);
    expect((await A.byName('Rice')).stockMilli).toBe(9000); expect((await B.byName('Rice')).stockMilli).toBe(9000);
  });

  it('the same barcode registered on two phones while apart: the older product keeps it everywhere', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); await A.connect('upload'); const B = await phone(cloud); await B.connect('download');
    await A.mk('Handwash A', '999', 50000, 1000); await new Promise((r) => setTimeout(r, 5)); await B.mk('Handwash B', '999', 50000, 2000);
    await A.sync.syncNow(); await B.sync.syncNow(); await A.sync.syncNow(); await B.sync.syncNow();
    for (const P of [A, B]) {
      expect((await P.byName('Handwash A')).barcode).toBe('999'); expect((await P.byName('Handwash B')).barcode).toBeUndefined();
      expect(await P.db.products.count()).toBe(2);
    }
    expect((await B.byName('Handwash B')).stockMilli).toBe(2000);                     // nothing lost, just the clashing code
  });

  it('syncing again changes nothing (no duplicates, nothing re-queued)', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); const id = await A.mk('Rice', '1', 100000, 10000); await A.sell('s', id, 1000, 100000); await A.connect('upload');
    const before = [await A.db.products.count(), await A.db.sales.count(), await A.db.movements.count()];
    await A.sync.syncNow(); await A.sync.syncNow();
    expect([await A.db.products.count(), await A.db.sales.count(), await A.db.movements.count()]).toEqual(before);
    expect(await A.sync.pendingCount()).toBe(0); expect((await A.byName('Rice')).stockMilli).toBe(9000);
  });

  it('works offline: changes wait, then upload when the network returns', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); await A.connect('upload'); const id = await A.mk('Rice', '1', 100000, 10000);
    cloud.offline = true;
    await A.sell('s1', id, 1000, 100000); await A.sync.syncNow();
    expect(await A.sync.pendingCount()).toBeGreaterThan(0);
    expect((await A.byName('Rice')).stockMilli).toBe(9000);                            // the shop keeps working
    let status: any; A.sync.syncStatus.subscribe((v) => (status = v))();
    expect(status.state).toBe('offline');
    cloud.offline = false; await A.sync.syncNow();
    expect(await A.sync.pendingCount()).toBe(0); expect(cloud.cols.sales.size).toBe(1); expect(cloud.cols.movements.size).toBe(2);
  });

  it('a stock movement that arrives before its product is held back, then applied', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); await A.connect('upload');
    const B = await phone(cloud); await B.connect('download');
    const id = await A.mk('Milo', '9', 100000, 10000); await A.sell('s', id, 2000, 200000); await A.sync.syncNow();
    const [uid, doc] = [...cloud.cols.products][0]; cloud.cols.products.delete(uid);   // commits becoming visible out of order: movements first
    await B.sync.syncNow();
    expect(await B.db.products.count()).toBe(0); expect(await B.db.movements.count()).toBe(0);      // held back, not lost
    cloud.cols.products.set(uid, { ...doc, ts: cloud.clock + 500 });                                // the product turns up
    await B.sync.syncNow();
    expect((await B.byName('Milo')).stockMilli).toBe(8000);
    expect(await B.db.movements.count()).toBe(2);
    const line = (await B.db.saleItems.toCollection().first())!;
    expect(line.productId).toBe((await B.byName('Milo')).id); expect(line.productUid).toBeUndefined();      // the sale line is linked up once the product exists
    await B.repo.refund((await B.db.sales.toCollection().first())!.id!, 'x'); expect((await B.byName('Milo')).stockMilli).toBe(10000);
  });

  it('first upload repairs a stock figure that its movements do not explain', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); const id = await A.mk('Rice', '1', 100000, 10000);
    await A.db.products.update(id, { stockMilli: 12000 });                             // e.g. data from an old backup
    await A.connect('upload');
    const B = await phone(cloud); await B.connect('download');
    expect((await B.byName('Rice')).stockMilli).toBe(12000);
  });

  it('connecting with data on both sides keeps an undo copy before replacing', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); await A.mk('Rice', '1', 100000, 10000); await A.connect('upload');
    const B = await phone(cloud); await B.mk('Old local item', '5', 1000, 1000);
    expect(await B.sync.checkBeforeConnect()).toEqual({ cloudHasData: true, localHasData: true });
    await B.connect('download');
    expect(await B.db.products.count()).toBe(1); expect((await B.byName('Rice')).name).toBe('Rice');
    expect(await B.db.snapshots.get('before-sync')).toBeTruthy();
  });

  it('restoring a file is refused while cloud sync is on, and the sync link survives a restore when it is off', async () => {
    const cloud = new Cloud();
    const A = await phone(cloud); await A.mk('Rice', '1', 100000, 10000); const file = await A.repo.exportBackup(); await A.connect('upload');
    await expect(A.repo.restoreBackup(file)).rejects.toThrow(/Cloud sync is on/);
    await A.sync.disconnectSync();
    await A.repo.setSettings({ sync_config: 'cfg', device_code: 'ABC' });
    await A.repo.restoreBackup(file);
    expect(await A.repo.getSetting('device_code')).toBe('ABC'); expect(await A.repo.getSetting('sync_config')).toBe('cfg');
  });

  it('a backup made before cloud sync can still be restored (records get ids)', async () => {
    const A = await phone(new Cloud()); await A.mk('Rice', '1', 100000, 10000);
    const b = JSON.parse(await A.repo.exportBackup()); b.products.forEach((p: any) => delete p.uid); b.movements.forEach((m: any) => delete m.uid);
    await A.repo.restoreBackup(JSON.stringify(b));
    expect((await A.byName('Rice')).uid).toBeTruthy(); expect((await A.db.movements.toCollection().first())!.uid).toBeTruthy();
  });
});

describe('Firebase config paste', () => {
  it('reads the block as the console shows it, and rejects an incomplete one', async () => {
    vi.resetModules(); (globalThis as any).__POS_DB_NAME__ = 'cfg-test';
    const { parseFirebaseConfig } = await import('./sync');
    const c = parseFirebaseConfig(`const firebaseConfig = {\n  apiKey: "AIzaXYZ",\n  authDomain: "shop.firebaseapp.com",\n  projectId: "shop",\n  storageBucket: "shop.appspot.com",\n  appId: "1:123:web:abc"\n};`);
    expect(c).toMatchObject({ apiKey: 'AIzaXYZ', projectId: 'shop', appId: '1:123:web:abc', authDomain: 'shop.firebaseapp.com' });
    expect(parseFirebaseConfig('{"apiKey":"k","projectId":"p","appId":"a"}').authDomain).toBe('p.firebaseapp.com');
    expect(() => parseFirebaseConfig('{ apiKey: "k" }')).toThrow(/projectId, appId/);
  });
});

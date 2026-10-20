import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import * as repo from './repo';
import { PosError, fmtMoney, parseMoney, parseQty, fmtQty, lineTotal, totals, settle } from './money';

describe('money maths', () => {
  it('formats and parses naira', () => {
    expect(fmtMoney(150000)).toBe('₦1,500.00'); expect(fmtMoney(5)).toBe('₦0.05');
    expect(parseMoney('1,500.50')).toBe(150050); expect(parseMoney('-5')).toBeNull(); expect(parseMoney('abc')).toBeNull(); expect(parseMoney('0.005')).toBe(1);
  });
  it('quantities', () => { expect(parseQty('2.5')).toBe(2500); expect(fmtQty(2500)).toBe('2.5'); expect(fmtQty(3000)).toBe('3'); });
  it('fractional line total', () => expect(lineTotal(50000, 2500)).toBe(125000));
  it('totals for several items with discount', () => { const t = totals([150000, 80000, 25050], 5000, 0); expect(t.subtotal).toBe(255050); expect(t.total).toBe(250050); });
  it('tax after discount', () => { const t = totals([100000], 10000, 750); expect(t.tax).toBe(6750); expect(t.total).toBe(96750); });
  it('discount capped', () => expect(totals([100], 999, 0).discount).toBe(100));
  it('cash change', () => { const s = settle(150000, [{ method: 'CASH', amount: 200000 }]); expect(s.change).toBe(50000); expect(s.applied[0].amount).toBe(150000); });
  it('insufficient cash rejected', () => expect(() => settle(150000, [{ method: 'CASH', amount: 100000 }])).toThrow(PosError));
  it('transfer must be exact', () => expect(() => settle(100000, [{ method: 'TRANSFER', amount: 120000 }])).toThrow(PosError));
  it('split payment', () => { const s = settle(100000, [{ method: 'CASH', amount: 40000 }, { method: 'TRANSFER', amount: 60000 }]); expect(s.change).toBe(0); expect(s.applied.length).toBe(2); });
  it('split with change reduces cash only', () => { const s = settle(100000, [{ method: 'TRANSFER', amount: 60000 }, { method: 'CASH', amount: 50000 }]); expect(s.change).toBe(10000); expect(s.applied.find((a) => a.method === 'CASH')!.amount).toBe(40000); });
});

const mk = (name: string, barcode: string | undefined, price: number, stock: number, cost: number | null = 30000) =>
  repo.saveProduct({ name, barcode, category: 'Test', costKobo: cost, priceKobo: price, stockMilli: stock, lowThresholdMilli: 5000, unit: 'PIECE' });
const sell = (token: string, pid: number, qty: number, total: number, paid: number) =>
  repo.completeSale({ token, lines: [{ productId: pid, qtyMilli: qty }], discountKobo: 0, payments: [{ method: 'CASH', amount: paid }], cashier: 'T', expectedTotal: total });

describe('repository', () => {
  beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())); });

  it('sale deducts stock, keeps historical price, writes movement', async () => {
    const id = await mk('Indomie', '111', 50000, 10000);
    const sale = await sell('t1', id, 3000, 150000, 200000);
    expect(sale.changeDue).toBe(50000); expect(sale.receiptNo).toBe('POS-000001');
    expect((await db.products.get(id))!.stockMilli).toBe(7000);
    const p = (await db.products.get(id))!; await repo.saveProduct({ ...p, priceKobo: 70000 });
    expect((await repo.saleDetail(sale.id!))!.items[0].unitPriceKobo).toBe(50000);
    expect((await db.movements.where('productId').equals(id).toArray()).map((m) => m.type)).toEqual(['OPENING', 'SALE']);
  });
  it('double submit creates one sale and one deduction', async () => {
    const id = await mk('Rice', '222', 100000, 10000);
    const a = await sell('same', id, 1000, 100000, 100000), b = await sell('same', id, 1000, 100000, 100000);
    expect(a.id).toBe(b.id); expect(await db.sales.count()).toBe(1); expect((await db.products.get(id))!.stockMilli).toBe(9000);
  });
  it('insufficient stock is rejected and nothing is saved', async () => {
    const id = await mk('Sugar', '333', 20000, 2000);
    await expect(sell('t3', id, 5000, 100000, 100000)).rejects.toThrow(PosError);
    expect((await db.products.get(id))!.stockMilli).toBe(2000); expect(await db.sales.count()).toBe(0);
    expect(await repo.getSetting('receipt_counter')).toBeUndefined();
  });
  it('failed payment validation rolls back everything', async () => {
    const id = await mk('Salt', '334', 20000, 5000);
    await expect(sell('t4', id, 1000, 20000, 5000)).rejects.toThrow(PosError);
    expect((await db.products.get(id))!.stockMilli).toBe(5000); expect(await db.sales.count()).toBe(0);
  });
  it('stale cart total is rejected', async () => {
    const id = await mk('Oil', '335', 20000, 5000);
    await expect(sell('t4b', id, 1000, 19000, 20000)).rejects.toThrow(/Prices changed/);
  });
  it('deactivated product cannot be sold', async () => {
    const id = await mk('Soap', '336', 20000, 5000); await repo.setActive(id, false);
    await expect(sell('t4c', id, 1000, 20000, 20000)).rejects.toThrow(/deactivated/);
  });
  it('duplicate barcode rejected, and via alternative barcode', async () => {
    await mk('A', '999', 100, 0);
    await expect(mk('B', '999', 100, 0)).rejects.toThrow(/already belongs/);
    await expect(repo.saveProduct({ name: 'C', barcode: '888', altBarcode: '999', category: '', costKobo: null, priceKobo: 1, stockMilli: 0, lowThresholdMilli: 0, unit: 'PIECE' })).rejects.toThrow(PosError);
  });
  it('products without barcode get internal code and can be found by name-less code', async () => {
    const id = await mk('Loose', undefined, 100, 0); const id2 = await mk('Loose2', undefined, 100, 0);
    const p = (await db.products.get(id))!; expect(p.internalCode).toBe('P' + String(id).padStart(5, '0'));
    expect((await repo.findByCode(p.internalCode))!.id).toBe(id); expect(id2).not.toBe(id);
  });
  it('validation: negatives rejected', async () => {
    await expect(mk('N', 'n1', -1, 0)).rejects.toThrow(PosError);
    await expect(mk('N', 'n2', 1, -5)).rejects.toThrow(PosError);
    await expect(mk('N', 'n3', 1, 0, -2)).rejects.toThrow(PosError);
  });
  it('stock adjustment records previous/new and cannot go below zero', async () => {
    const id = await mk('Beans', 'b1', 100, 1000);
    await repo.adjustStock(id, 4000, 'RECEIVED', 'Goods received', 'inv-1', 25000);
    const p = (await db.products.get(id))!; expect(p.stockMilli).toBe(5000); expect(p.costKobo).toBe(25000);
    await repo.adjustStock(id, -1000, 'DAMAGED', 'Damaged');
    const m = (await db.movements.where('productId').equals(id).toArray()).at(-1)!; expect([m.prevMilli, m.newMilli]).toEqual([5000, 4000]);
    await expect(repo.adjustStock(id, -9000, 'LOSS', 'Loss')).rejects.toThrow(PosError);
  });
  it('refund restores stock and keeps the sale', async () => {
    const id = await mk('Milk', '444', 100000, 5000); const s = await sell('t5', id, 2000, 200000, 200000);
    await repo.refund(s.id!, 'wrong item');
    expect((await db.products.get(id))!.stockMilli).toBe(5000); expect((await db.sales.get(s.id!))!.status).toBe('REFUNDED');
    await expect(repo.refund(s.id!, '')).rejects.toThrow(PosError);
    const r = await repo.report(0, Date.now() + 1000); expect(r.saleCount).toBe(0); expect(r.refundedCount).toBe(1);
  });
  it('report: totals, methods, gross profit, missing cost', async () => {
    const a = await mk('A', 'r1', 100000, 10000, 60000), b = await mk('B', 'r2', 50000, 10000, null);
    await sell('r-1', a, 2000, 200000, 200000);
    let r = await repo.report(0, Date.now() + 1000);
    expect(r.totalSales).toBe(200000); expect(r.cogs).toBe(120000); expect(r.grossProfit).toBe(80000); expect(r.byMethod.CASH).toBe(200000);
    await sell('r-2', b, 1000, 50000, 50000);
    r = await repo.report(0, Date.now() + 1000); expect(r.grossProfit).toBeNull(); expect(r.uncostedLines).toBe(1); expect(r.saleCount).toBe(2);
  });
  it('PIN set/check', async () => {
    expect(await repo.hasPin()).toBe(false); await repo.setPin('1234');
    expect(await repo.hasPin()).toBe(true); expect(await repo.checkPin('1234')).toBe(true); expect(await repo.checkPin('0000')).toBe(false);
    expect(await repo.getSetting('pin_hash')).not.toContain('1234');
  });
  it('backup round-trip has no duplicates and receipt numbers continue', async () => {
    const id = await mk('Salt', '555', 10000, 5000); await sell('t6', id, 1000, 10000, 10000);
    const json = await repo.exportBackup();
    await repo.restoreBackup(json); await repo.restoreBackup(json);
    expect(await db.sales.count()).toBe(1); expect(await db.products.count()).toBe(1); expect(await db.saleItems.count()).toBe(1);
    expect((await sell('t7', id, 1000, 10000, 10000)).receiptNo).toBe('POS-000002');
  });
  it('invalid backup is rejected without touching data', async () => {
    const id = await mk('Keep', 'k1', 100, 100);
    await expect(repo.restoreBackup('{"format":"other"}')).rejects.toThrow(PosError);
    await expect(repo.restoreBackup('not json')).rejects.toThrow(PosError);
    const bad = JSON.parse(await repo.exportBackup()); bad.saleItems.push({ saleId: 999, productName: 'x' });
    await expect(repo.restoreBackup(JSON.stringify(bad))).rejects.toThrow(/inconsistent/);
    expect(await db.products.get(id)).toBeTruthy();
  });
  it('restore accepts a file with BOM and without a format key', async () => {
    const id = await mk('Bom', 'bom1', 100, 1000); await sell('bom-s', id, 1000, 100, 100);
    const o = JSON.parse(await repo.exportBackup()); delete o.format; delete o.version;
    await repo.restoreBackup('\uFEFF  ' + JSON.stringify(o, null, 2));
    expect(await db.products.count()).toBe(1); expect(await db.sales.count()).toBe(1);
  });
  it('non-backup JSON gives a descriptive error', async () => {
    await expect(repo.restoreBackup('{"hello":1}')).rejects.toThrow(/not a Provision POS backup.*hello/);
    await expect(repo.restoreBackup('Product,Qty\nA,1')).rejects.toThrow(/not readable/);
  });
  it('daily snapshot once per day, keeps 7, and pre-restore undo works', async () => {
    expect(await repo.dueDailyDownload()).toBe(false);          // no data yet
    const id = await mk('Snap', 's1', 100, 1000);
    await repo.dailySnapshot(); await repo.dailySnapshot();
    expect((await repo.listSnapshots()).length).toBe(1);
    expect(await repo.dueDailyDownload()).toBe(true); await repo.markDailyDownload(); expect(await repo.dueDailyDownload()).toBe(false);
    await repo.setSettings({ auto_backup: '0', last_auto_download: '' }); expect(await repo.dueDailyDownload()).toBe(false);
    for (let i = 1; i <= 9; i++) await db.snapshots.put({ date: `2020-01-0${i}`, createdAt: i, json: '{}' });
    await db.snapshots.clear(); for (let i = 1; i <= 9; i++) await db.snapshots.put({ date: `2020-01-0${i}`, createdAt: i, json: '{}' });
    await repo.dailySnapshot(); expect((await repo.listSnapshots()).length).toBe(7);
    const json = await repo.exportBackup(); await sell('sn-1', id, 1000, 100, 100);       // stock now 0
    await repo.restoreBackup(json);                                                          // back to stock 1000
    expect((await db.products.get(id))!.stockMilli).toBe(1000);
    await repo.restoreSnapshot('pre-restore');                                               // undo -> stock 0 again
    expect((await db.products.get(id))!.stockMilli).toBe(0);
  });
  it('restores a realistic backup (refund, tax, discount, split, PIN) written to a Blob and read back', async () => {
    await repo.setSettings({ tax_bps: '750', receipt_prefix: 'SHOP', store_name: 'Mama Ngozi’s ₦ Store' });
    const a = await mk('Garri', undefined, 120000, 20000, null), b = await mk('Soap', 'real2', 35050, 20000, 20000);
    const s1 = await repo.completeSale({ token: 'x1', lines: [{ productId: a, qtyMilli: 2500 }, { productId: b, qtyMilli: 3000 }], discountKobo: 5000,
      payments: [{ method: 'TRANSFER', amount: 100000 }, { method: 'CASH', amount: 300000 }], cashier: 'Ada', expectedTotal: 0 }).catch((e) => e);
    expect(s1).toBeInstanceOf(PosError);                                // wrong expected total is refused
    const t = (await import('./money')).totals([ (await import('./money')).lineTotal(120000, 2500), (await import('./money')).lineTotal(35050, 3000) ], 5000, 750);
    const sale = await repo.completeSale({ token: 'x2', lines: [{ productId: a, qtyMilli: 2500 }, { productId: b, qtyMilli: 3000 }], discountKobo: 5000,
      payments: [{ method: 'TRANSFER', amount: 100000 }, { method: 'CASH', amount: t.total }], cashier: 'Ada', expectedTotal: t.total });
    await repo.refund(sale.id!, 'test'); await repo.setPin('4321');
    const blob = new Blob([await repo.exportBackup()], { type: 'application/json' });
    const text = await blob.text();                                      // what the file picker path does
    await repo.restoreBackup(text);
    expect(await db.sales.count()).toBe(1); expect((await db.sales.toCollection().first())!.status).toBe('REFUNDED');
    expect(await repo.checkPin('4321')).toBe(true); expect(await repo.getSetting('store_name')).toBe('Mama Ngozi’s ₦ Store');
  });
  it('empty file and web page get specific messages', async () => {
    await expect(repo.restoreBackup('')).rejects.toThrow(/empty/);
    await expect(repo.restoreBackup('<!doctype html><html>')).rejects.toThrow(/web page/);
  });
});

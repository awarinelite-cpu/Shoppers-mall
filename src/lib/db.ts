import Dexie, { type Table } from 'dexie';

export interface Product {
  id?: number; name: string; barcode?: string; altBarcode?: string; internalCode: string; category: string;
  costKobo: number | null; priceKobo: number; stockMilli: number; lowThresholdMilli: number; unit: string;
  supplier?: string; description?: string; expiryAt?: number | null; active: boolean; createdAt: number; updatedAt: number;
  /** Cloud sync: globally unique id, time of the last edit to the product details (not stock), and 1 = waiting to be uploaded. */
  uid?: string; metaAt?: number; dirty?: 1;
}
export interface Sale {
  id?: number; receiptNo: string; clientToken: string; createdAt: number; subtotal: number; discount: number; tax: number; total: number;
  tendered: number; changeDue: number; status: 'COMPLETED' | 'REFUNDED'; paymentStatus: string; methods: string; cashier: string;
  refundedAt?: number; refundReason?: string; uid?: string; dirty?: 1;
}
export interface SaleItem {
  id?: number; saleId: number; productId?: number; productName: string; barcode?: string; category: string; unit: string;
  qtyMilli: number; unitPriceKobo: number; unitCostKobo: number | null; lineTotalKobo: number;
  /** Only set on sales downloaded before their product arrived; links the line up once it does. */
  productUid?: string;
}
export interface Payment { id?: number; saleId: number; method: string; amountKobo: number; reference?: string; createdAt: number; status: string }
export interface Movement {
  id?: number; productId: number; productName: string; type: string; changeMilli: number; prevMilli: number; newMilli: number;
  reason: string; note?: string; refId?: number; createdAt: number; uid?: string; dirty?: 1;
}
/** Product fields whose change counts as an edit of the product details (stock is synced through movements instead). */
export const PRODUCT_META = ['name', 'barcode', 'altBarcode', 'internalCode', 'category', 'costKobo', 'priceKobo', 'lowThresholdMilli', 'unit', 'supplier', 'description', 'expiryAt', 'active'];
export const newUid = () => crypto.randomUUID();
/** Set by the sync engine; called (debounced there) whenever something becomes waiting to upload. */
export const syncBus: { kick: (() => void) | null } = { kick: null };
const stamp = (o: any) => { if (!o.uid) o.uid = newUid(); if (o.dirty === 0) delete o.dirty; else { o.dirty = 1; syncBus.kick?.(); } };

export interface Setting { key: string; value: string }
export interface Snapshot { date: string; createdAt: number; json: string }

class PosDB extends Dexie {
  products!: Table<Product, number>;
  sales!: Table<Sale, number>;
  saleItems!: Table<SaleItem, number>;
  payments!: Table<Payment, number>;
  movements!: Table<Movement, number>;
  settings!: Table<Setting, string>;
  snapshots!: Table<Snapshot, string>;
  constructor() {
    super((globalThis as any).__POS_DB_NAME__ ?? 'provision_pos');
    // Add new versions below with .upgrade() when the schema changes; never delete user data.
    this.version(1).stores({
      products: '++id,&barcode,altBarcode,name,internalCode,category',
      sales: '++id,&receiptNo,&clientToken,createdAt',
      saleItems: '++id,saleId,productId',
      payments: '++id,saleId',
      movements: '++id,productId,createdAt',
      settings: 'key'
    });
    // v2: automatic daily snapshots kept inside the app (safety net against mistakes and bad restores)
    this.version(2).stores({ snapshots: 'date' });
    // v3: cloud sync. Every product, sale and stock movement gets a globally unique uid; `dirty` marks records waiting to upload.
    this.version(3).stores({
      products: '++id,&barcode,altBarcode,name,internalCode,category,&uid,dirty',
      sales: '++id,&receiptNo,&clientToken,createdAt,&uid,dirty',
      movements: '++id,productId,createdAt,&uid,dirty'
    }).upgrade(async (tx) => {
      for (const t of ['products', 'sales', 'movements'])
        await tx.table(t).toCollection().modify((r: any) => { r.uid = r.uid ?? newUid(); r.dirty = 1; if (t === 'products') r.metaAt = r.updatedAt ?? Date.now(); });
    });
    // Records are marked automatically, so no code path can forget to sync. A record written with dirty: 0 (or a change that
    // carries a `dirty` key) comes from the sync engine itself and is not queued for upload again.
    this.products.hook('creating', (_k, o: any) => { o.metaAt = o.metaAt ?? o.updatedAt ?? Date.now(); stamp(o); });
    this.products.hook('updating', (mods: any) => {
      if ('dirty' in mods || !PRODUCT_META.some((k) => k in mods)) return;
      syncBus.kick?.(); return { dirty: 1, metaAt: Date.now() };
    });
    this.sales.hook('creating', (_k, o: any) => stamp(o));
    this.sales.hook('updating', (mods: any) => { if ('dirty' in mods || !('status' in mods || 'refundedAt' in mods)) return; syncBus.kick?.(); return { dirty: 1 }; });
    this.movements.hook('creating', (_k, o: any) => stamp(o));
  }
}
export const db = new PosDB();

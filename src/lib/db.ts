import Dexie, { type Table } from 'dexie';

export interface Product {
  id?: number; name: string; barcode?: string; altBarcode?: string; internalCode: string; category: string;
  costKobo: number | null; priceKobo: number; stockMilli: number; lowThresholdMilli: number; unit: string;
  supplier?: string; description?: string; expiryAt?: number | null; active: boolean; createdAt: number; updatedAt: number;
}
export interface Sale {
  id?: number; receiptNo: string; clientToken: string; createdAt: number; subtotal: number; discount: number; tax: number; total: number;
  tendered: number; changeDue: number; status: 'COMPLETED' | 'REFUNDED'; paymentStatus: string; methods: string; cashier: string;
  refundedAt?: number; refundReason?: string;
}
export interface SaleItem {
  id?: number; saleId: number; productId?: number; productName: string; barcode?: string; category: string; unit: string;
  qtyMilli: number; unitPriceKobo: number; unitCostKobo: number | null; lineTotalKobo: number;
}
export interface Payment { id?: number; saleId: number; method: string; amountKobo: number; reference?: string; createdAt: number; status: string }
export interface Movement {
  id?: number; productId: number; productName: string; type: string; changeMilli: number; prevMilli: number; newMilli: number;
  reason: string; note?: string; refId?: number; createdAt: number;
}
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
    super('provision_pos');
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
  }
}
export const db = new PosDB();

// Money = integer kobo. Quantity = integer thousandths of a unit ("milli"). No floating point for totals.
export class PosError extends Error {}

export function fmtMoney(kobo: number): string {
  const neg = kobo < 0, a = Math.abs(kobo);
  const s = '₦' + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0');
  return neg ? '-' + s : s;
}

/** Decimal string -> integer with `scale` decimals, half-up. Returns null if invalid or negative. */
function toScaled(text: string, scale: number): number | null {
  const t = text.replace(/[,₦\s]/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const [w = '0', f = ''] = t.split('.');
  let n = Number((w || '0') + f.slice(0, scale).padEnd(scale, '0'));
  if (f.length > scale && Number(f[scale]) >= 5) n += 1;
  return Number.isSafeInteger(n) ? n : null;
}
export const parseMoney = (t: string) => toScaled(t, 2);
export const parseQty = (t: string) => toScaled(t, 3);

export function fmtQty(milli: number): string {
  const s = (milli / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
/** Input-box text for a kobo amount, e.g. 150050 -> "1500.50" */
export const moneyInput = (kobo: number) => (kobo / 100).toFixed(2);

export const ONE = 1000;
export const UNITS: Record<string, string> = { PIECE: 'piece(s)', PACK: 'pack(s)', CARTON: 'carton(s)', KG: 'kg', G: 'g', LITRE: 'litre(s)', ML: 'ml' };
export const METHODS: Record<string, string> = { CASH: 'Cash', TRANSFER: 'Bank transfer', POS: 'POS terminal', OTHER: 'Other' };

export const lineTotal = (unitPrice: number, qtyMilli: number) => Math.floor((unitPrice * qtyMilli + 500) / 1000);

export interface Totals { subtotal: number; discount: number; tax: number; total: number }
/** taxBps: 7.5% = 750. Tax applies to (subtotal - discount). */
export function totals(lines: number[], discount: number, taxBps: number): Totals {
  const subtotal = lines.reduce((a, b) => a + b, 0);
  const d = Math.min(Math.max(discount, 0), subtotal);
  const base = subtotal - d;
  const tax = Math.floor((base * taxBps + 5000) / 10000);
  return { subtotal, discount: d, tax, total: base + tax };
}

export interface PayIn { method: string; amount: number }
export interface Settlement { tendered: number; change: number; applied: PayIn[] }
/** Only cash can produce change; non-cash must be exact portions. Applied cash is net of change. */
export function settle(total: number, payments: PayIn[]): Settlement {
  const pos = payments.filter((p) => p.amount > 0);
  if (!pos.length) throw new PosError('Enter a payment amount');
  const tendered = pos.reduce((a, p) => a + p.amount, 0);
  const cash = pos.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.amount, 0);
  if (tendered - cash > total) throw new PosError('Non-cash payments exceed the total');
  if (tendered < total) throw new PosError('Amount received is less than the total due');
  let remove = tendered - total;
  const applied = [...pos].reverse().map((p) => {
    if (p.method === 'CASH' && remove > 0) { const cut = Math.min(remove, p.amount); remove -= cut; return { ...p, amount: p.amount - cut }; }
    return p;
  }).reverse().filter((p) => p.amount > 0);
  return { tendered, change: tendered - total, applied };
}

export const fmtDateTime = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function parseDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()); if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d.getTime() : null;
}
export function dayRange(offsetDays = 0): [number, number] {
  const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(0, 0, 0, 0);
  return [d.getTime(), d.getTime() + 86_400_000 - 1];
}

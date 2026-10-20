import { liveQuery } from 'dexie';
import { readable, writable, get } from 'svelte/store';
import { db, type Product } from './db';
import * as repo from './repo';
import { PosError, lineTotal, totals as calcTotals, parseQty, UNITS, ONE } from './money';

// ---------- live data ----------
export const settings = readable<Record<string, string> | undefined>(undefined, (set) => {
  const sub = liveQuery(() => db.settings.toArray()).subscribe((rows) => set(Object.fromEntries(rows.map((r) => [r.key, r.value]))));
  return () => sub.unsubscribe();
});
export const S = (key: string, def = '') => get(settings)?.[key] || def;

// ---------- router (hash based so it works offline and on any static host) ----------
export const route = writable(location.hash.slice(1) || '/');
window.addEventListener('hashchange', () => route.set(location.hash.slice(1) || '/'));
export const go = (p: string) => { location.hash = p; };
export const replace = (p: string) => { history.replaceState(null, '', '#' + p); route.set(p); };
export const back = () => history.back();

// ---------- toast / dialogs ----------
export const toastMsg = writable<string | null>(null);
let tt: ReturnType<typeof setTimeout>;
export function toast(m: string) { toastMsg.set(m); clearTimeout(tt); tt = setTimeout(() => toastMsg.set(null), 3500); }

type Dlg = { kind: 'confirm' | 'prompt'; title: string; text?: string; label?: string; value?: string; ok: string; number?: boolean; resolve: (v: any) => void };
export const dialog = writable<Dlg | null>(null);
export const confirmBox = (title: string, text: string, ok = 'Confirm') => new Promise<boolean>((resolve) => dialog.set({ kind: 'confirm', title, text, ok, resolve }));
export const promptBox = (title: string, label: string, value = '', number = false, text = '') =>
  new Promise<string | null>((resolve) => dialog.set({ kind: 'prompt', title, label, value, text, ok: 'OK', number, resolve }));
export async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); }
  catch (e) { if (e instanceof PosError) toast(e.message); else { console.error(e); toast('Something went wrong. Nothing was changed.'); } }
}

// ---------- cart ----------
export interface CartLine { product: Product; qtyMilli: number }
export const cart = writable<CartLine[]>([]);
export const discount = writable(0);
export let token = crypto.randomUUID();
export const newToken = () => (token = crypto.randomUUID());
const allowNeg = () => true;   // selling at zero/low stock is always allowed
const taxBps = () => parseInt(S('tax_bps', '0')) || 0;

export function cartTotals(lines: CartLine[], disc: number) {
  return calcTotals(lines.map((l) => lineTotal(l.product.priceKobo, l.qtyMilli)), disc, taxBps());
}
/** Why this product can't be added to the cart right now, or null if it can. */
export function cartBlockReason(p: Product, qty = ONE): string | null {
  if (!p.active) return `${p.name} is deactivated`;
  const l = get(cart).find((x) => x.product.id === p.id);
  const nq = (l ? l.qtyMilli : 0) + qty;
  if (!allowNeg() && nq > p.stockMilli) {
    const have = p.stockMilli / 1000;
    return have <= 0 ? `${p.name} is out of stock (0 in stock). Add stock first.` : `Only ${have} ${UNITS[p.unit]} of ${p.name} in stock`;
  }
  return null;
}
export function addToCart(p: Product, qty = ONE): boolean {
  const why = cartBlockReason(p, qty);
  if (why) { toast(why); return false; }
  const lines = get(cart); const i = lines.findIndex((l) => l.product.id === p.id);
  const nq = (i >= 0 ? lines[i].qtyMilli : 0) + qty;
  cart.set(i >= 0 ? lines.map((l, j) => (j === i ? { product: p, qtyMilli: nq } : l)) : [...lines, { product: p, qtyMilli: nq }]);
  return true;
}
export function setQty(id: number, q: number) {
  const lines = get(cart); const l = lines.find((x) => x.product.id === id); if (!l) return;
  if (q <= 0) return cart.set(lines.filter((x) => x.product.id !== id));
  if (!allowNeg() && q > l.product.stockMilli) return toast(`Only ${l.product.stockMilli / 1000} in stock`);
  cart.set(lines.map((x) => (x.product.id === id ? { ...x, qtyMilli: q } : x)));
}
export const removeLine = (id: number) => cart.update((l) => l.filter((x) => x.product.id !== id));
export const clearCart = () => { cart.set([]); discount.set(0); };
export { parseQty };

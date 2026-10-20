import type { Sale, SaleItem, Payment } from './db';
import { fmtMoney, fmtQty, fmtDateTime, METHODS } from './money';

export function receiptText(s: Record<string, string>, sale: Sale, items: SaleItem[], pays: Payment[]): string {
  const L: string[] = [];
  L.push(s.store_name || 'Store'); if (s.address) L.push(s.address); if (s.phone) L.push('Tel: ' + s.phone);
  L.push('--------------------------------', `Receipt No: ${sale.receiptNo}`, `Date: ${fmtDateTime(sale.createdAt)}`);
  if (sale.cashier) L.push(`Served by: ${sale.cashier}`);
  if (sale.status === 'REFUNDED') L.push('*** REFUNDED ***');
  L.push('--------------------------------');
  items.forEach((i) => { L.push(i.productName, `  ${fmtQty(i.qtyMilli)} x ${fmtMoney(i.unitPriceKobo)} = ${fmtMoney(i.lineTotalKobo)}`); });
  L.push('--------------------------------', `Subtotal: ${fmtMoney(sale.subtotal)}`);
  if (sale.discount > 0) L.push(`Discount: -${fmtMoney(sale.discount)}`);
  if (sale.tax > 0) L.push(`Tax: ${fmtMoney(sale.tax)}`);
  L.push(`TOTAL: ${fmtMoney(sale.total)}`);
  pays.forEach((p) => L.push(`Paid (${METHODS[p.method] ?? p.method}): ${fmtMoney(p.amountKobo)}`));
  if (sale.changeDue > 0) L.push(`Amount tendered: ${fmtMoney(sale.tendered)}`, `Change: ${fmtMoney(sale.changeDue)}`);
  L.push('--------------------------------', s.footer || 'Thank you!');
  return L.join('\n');
}

export function download(name: string, content: string, mime: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

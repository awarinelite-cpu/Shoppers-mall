/** Looks a barcode up in Open Food Facts (free, no key) and returns a product name, or null if unknown/offline. */
export async function lookupName(code: string, f: typeof fetch = fetch): Promise<string | null> {
  const c = code.trim(); if (!/^\d{6,14}$/.test(c)) return null;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await f(`https://world.openfoodfacts.org/api/v2/product/${c}.json?fields=product_name,brands,quantity`, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json(); const p = j?.product; if (!p?.product_name) return null;
    const brand = String(p.brands ?? '').split(',')[0].trim(), nm = String(p.product_name).trim();
    const full = brand && !nm.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${nm}` : nm;
    return (p.quantity ? `${full} ${String(p.quantity).trim()}` : full).slice(0, 80);
  } catch { return null; } finally { clearTimeout(t); }
}

<script lang="ts">
  import { onMount } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { findByCode } from '../lib/repo';
  import { fmtMoney, fmtQty, lineTotal, parseMoney, parseQty, UNITS, ONE } from '../lib/money';
  import { cart, discount, cartTotals, addToCart, cartBlockReason, setQty, removeLine, clearCart, go, route, confirmBox, promptBox, toast, settings } from '../lib/stores';
  import Header from './Header.svelte';
  import Scanner from './Scanner.svelte';

  const products = liveQuery(() => db.products.toArray());
  let query = '', scanning = false, summary = '';
  onMount(() => { if ($route.includes('scan=1')) { scanning = true; history.replaceState(null, '', '#/sale'); } });

  $: matches = query.trim() ? ($products ?? []).filter((p) => p.active && (p.name.toLowerCase().includes(query.toLowerCase()) || p.barcode === query.trim() ||
      p.internalCode.toLowerCase() === query.trim().toLowerCase() || p.category.toLowerCase().includes(query.toLowerCase()))).slice(0, 6) : [];
  $: t = cartTotals($cart, $discount);
  $: taxOn = (parseInt($settings?.tax_bps ?? '0') || 0) > 0;

  async function onScan(code: string) {
    const p = await findByCode(code);
    if (!p) return { status: 'Not registered: ' + code, notFound: true };
    if (addToCart(p)) {
      const l = $cart.find((x) => x.product.id === p.id)!;
      summary = `Items: ${$cart.length}   Total: ${fmtMoney(cartTotals($cart, $discount).total)}`;
      return { status: `${p.name} · ${fmtMoney(p.priceKobo)} · x${fmtQty(l.qtyMilli)} (stock ${fmtQty(p.stockMilli)})` };
    }
    return { status: cartBlockReason(p) ?? `Could not add ${p.name}` };
  }
  async function editQty(id: number, cur: number, unit: string) {
    const v = await promptBox('Quantity', `Quantity (${UNITS[unit]})`, fmtQty(cur), true); if (v === null) return;
    const q = parseQty(v); q === null ? toast('Invalid quantity') : setQty(id, q);
  }
  async function setDiscount() {
    const v = await promptBox('Discount (₦)', 'Amount off', $discount ? ($discount / 100).toFixed(2) : '', true); if (v === null) return;
    const d = v.trim() === '' ? 0 : parseMoney(v);
    if (d === null) return toast('Invalid amount'); if (d > t.subtotal) return toast('Discount is more than the subtotal');
    discount.set(d);
  }
  async function clear() { if (await confirmBox('Clear cart?', 'All items will be removed. Stock is not affected.', 'Clear')) clearCart(); }
</script>

<Header title="New Sale" canBack={false}>{#if $cart.length}<button on:click={clear}>🗑 Clear</button>{/if}</Header>
<main>
  <div class="row">
    <input bind:value={query} placeholder="Search name / barcode" />
    <button class="sm fit" style="padding:14px" on:click={() => (scanning = true)} aria-label="Scan barcode">📷 Scan</button>
  </div>
  {#if matches.length}
    <div class="card">
      {#each matches as p (p.id)}
        <div class="item" role="button" tabindex="0" on:click={() => addToCart(p) && (query = '')} on:keydown={(e) => e.key === 'Enter' && addToCart(p) && (query = '')}>
          <div class="t">{p.name}</div><div class="sub">{fmtMoney(p.priceKobo)} · stock {fmtQty(p.stockMilli)} {UNITS[p.unit]}</div>
        </div>
      {/each}
    </div>
  {/if}

  {#if !$cart.length}<p class="empty">Cart is empty. Scan or search for a product.</p>{/if}
  {#each $cart as l (l.product.id)}
    <div class="card">
      <div class="between"><div class="t">{l.product.name}</div><button class="sm" on:click={() => removeLine(l.product.id ?? 0)} aria-label="Remove">✕</button></div>
      <div class="sub">{fmtMoney(l.product.priceKobo)} each · stock {fmtQty(l.product.stockMilli)}</div>
      <div class="between" style="align-items:center;margin-top:6px">
        <div class="qty">
          <button on:click={() => setQty(l.product.id ?? 0, l.qtyMilli - ONE)} aria-label="Decrease">−</button>
          <button class="n" on:click={() => editQty(l.product.id ?? 0, l.qtyMilli, l.product.unit)}>{fmtQty(l.qtyMilli)}</button>
          <button on:click={() => setQty(l.product.id ?? 0, l.qtyMilli + ONE)} aria-label="Increase">+</button>
        </div>
        <div class="total">{fmtMoney(lineTotal(l.product.priceKobo, l.qtyMilli))}</div>
      </div>
    </div>
  {/each}

  {#if $cart.length}
    <div class="card">
      <div class="between"><span>Subtotal</span><span>{fmtMoney(t.subtotal)}</span></div>
      <div class="between" on:click={setDiscount} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && setDiscount()}><span>Discount (tap to set)</span><span>-{fmtMoney(t.discount)}</span></div>
      {#if taxOn}<div class="between"><span>Tax</span><span>{fmtMoney(t.tax)}</span></div>{/if}
      <div class="between total"><span>TOTAL</span><span>{fmtMoney(t.total)}</span></div>
      <button class="btn" on:click={() => go('/checkout')}>Checkout</button>
    </div>
  {/if}
</main>

{#if scanning}
  <Scanner mode="sale" {summary} onCode={onScan} onClose={() => (scanning = false)}
    onRegister={(c) => { scanning = false; go('/product/new?barcode=' + encodeURIComponent(c)); }} />
{/if}

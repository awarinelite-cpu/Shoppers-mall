<script lang="ts">
  import { cart, discount, cartTotals, clearCart, token, newToken, replace, confirmBox, toast, S, safe } from '../lib/stores';
  import { completeSale } from '../lib/repo';
  import { fmtMoney, fmtQty, lineTotal, parseMoney, settle, METHODS, PosError, moneyInput, type PayIn } from '../lib/money';
  import Header from './Header.svelte';

  $: t = cartTotals($cart, $discount);
  let rows: { method: string; amount: string }[] = [{ method: S('default_pay', 'CASH'), amount: moneyInput(cartTotals($cart, $discount).total) }];
  let busy = false;

  $: pays = rows.map((r): PayIn => ({ method: r.method, amount: parseMoney(r.amount) ?? 0 }));
  $: tendered = pays.reduce((a, p) => a + p.amount, 0);
  $: change = Math.max(tendered - t.total, 0);
  $: error = (() => { try { settle(t.total, pays); return ''; } catch (e) { return e instanceof PosError ? e.message : 'Invalid payment'; } })();

  function split() { rows = [...rows, { method: 'TRANSFER', amount: moneyInput(Math.max(t.total - tendered, 0)) }]; }
  function exactCash() { rows = [{ method: 'CASH', amount: moneyInput(t.total) }]; }

  async function complete() {
    if (busy || !$cart.length) return;
    if (!(await confirmBox('Complete this sale?', `Total ${fmtMoney(t.total)}. Stock will be deducted.`, 'Complete'))) return;
    busy = true;                                                  // blocks repeat taps; the token makes retries safe too
    const sale = await safe(() => completeSale({ token, lines: $cart.map((l) => ({ productId: l.product.id!, qtyMilli: l.qtyMilli })),
      discountKobo: $discount, payments: pays, cashier: S('cashier'), expectedTotal: t.total }));
    busy = false;
    if (sale) { clearCart(); newToken(); replace('/receipt/' + sale.id); }
  }
</script>

<Header title="Checkout" />
<main>
  {#if !$cart.length}<p class="empty">The cart is empty.</p>{:else}
  <div class="card">
    {#each $cart as l}<div class="between"><span>{l.product.name} ×{fmtQty(l.qtyMilli)}</span><span>{fmtMoney(lineTotal(l.product.priceKobo, l.qtyMilli))}</span></div>{/each}
    <hr />
    <div class="between"><span>Subtotal</span><span>{fmtMoney(t.subtotal)}</span></div>
    <div class="between"><span>Discount</span><span>-{fmtMoney(t.discount)}</span></div>
    {#if t.tax}<div class="between"><span>Tax</span><span>{fmtMoney(t.tax)}</span></div>{/if}
    <div class="between total"><span>TOTAL DUE</span><span>{fmtMoney(t.total)}</span></div>
  </div>
  <h3>Payment</h3>
  {#each rows as r, i}
    <div class="row">
      <select bind:value={r.method}>{#each Object.entries(METHODS) as [k, v]}<option value={k}>{v}</option>{/each}</select>
      <input bind:value={r.amount} inputmode="decimal" aria-label="Amount" />
      {#if rows.length > 1}<button class="sm fit" on:click={() => (rows = rows.filter((_, j) => j !== i))}>✕</button>{/if}
    </div>
  {/each}
  <div class="row"><button class="btn alt" on:click={split}>Split payment</button><button class="btn alt" on:click={exactCash}>Exact cash</button></div>
  <div class="between" style="margin-top:10px"><span>Received</span><span>{fmtMoney(tendered)}</span></div>
  <div class="between"><b>Change due</b><b>{fmtMoney(change)}</b></div>
  {#if error}<p class="err">{error}</p>{/if}
  <p class="hint">Bank transfer and POS terminal payments are recorded as entered; this app does not verify them.</p>
  <button class="btn" disabled={!!error || busy} on:click={complete}>{busy ? 'Saving…' : 'Complete sale'}</button>
  {/if}
</main>

<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { report } from '../lib/repo';
  import { dayRange, fmtMoney, fmtQty, fmtDate, parseDate, METHODS } from '../lib/money';
  import { download } from '../lib/receipt';
  import Header from './Header.svelte';

  let preset = 'TODAY', fromT = '', toT = '';
  $: range = ((): [number, number] | null => {
    if (preset === 'TODAY') return dayRange(0);
    if (preset === 'WEEK') return [dayRange(-6)[0], dayRange(0)[1]];
    if (preset === 'MONTH') { const d = new Date(); return [dayRange(1 - d.getDate())[0], dayRange(0)[1]]; }
    const a = parseDate(fromT), b = parseDate(toT); return a !== null && b !== null && b >= a ? [a, b + 86_399_999] : null;
  })();
  $: obs = range ? liveQuery(async () => { await db.sales.count(); return report(range![0], range![1]); }) : null;
  $: r = obs ? $obs : undefined;
  const prods = liveQuery(() => db.products.toArray());
  $: unsold = r ? ($prods ?? []).filter((p) => p.active && !r!.byProduct.some((l) => l.name === p.name)) : [];

  function csv() {
    if (!r || !range) return;
    const rows = ['Product,Category,Quantity,Revenue NGN', ...r.byProduct.map((l) => `"${l.name.replace(/"/g, '""')}","${l.category}",${fmtQty(l.qtyMilli)},${(l.revenue / 100).toFixed(2)}`)];
    download(`sales_report_${fmtDate(range[0])}.csv`, rows.join('\n'), 'text/csv');
  }
</script>
<Header title="Reports" />
<main>
  <div class="chips">{#each [['TODAY', 'Today'], ['WEEK', '7 days'], ['MONTH', 'This month'], ['CUSTOM', 'Custom']] as [k, l]}<button class="chip" class:on={preset === k} on:click={() => (preset = k)}>{l}</button>{/each}</div>
  {#if preset === 'CUSTOM'}<div class="row"><input type="date" bind:value={fromT} /><input type="date" bind:value={toT} /></div>{/if}
  {#if !range}<p class="empty">Choose a valid date range.</p>
  {:else if !r}<p class="empty">Loading…</p>
  {:else if r.saleCount === 0 && r.refundedCount === 0}<p class="empty">No sales in this period.</p>
  {:else}
    <div class="grid2">
      <div class="stat"><div class="l">Total sales</div><div class="v">{fmtMoney(r.totalSales)}</div></div>
      <div class="stat"><div class="l">Transactions</div><div class="v">{r.saleCount}</div></div>
      <div class="stat"><div class="l">Items sold</div><div class="v">{fmtQty(r.itemsMilli)}</div></div>
      <div class="stat"><div class="l">Average sale</div><div class="v">{fmtMoney(r.avgSale)}</div></div>
    </div>
    <div class="card">
      <div>Net sales (excl. tax): <b>{fmtMoney(r.netSales)}</b> · Discounts: {fmtMoney(r.discount)} · Tax: {fmtMoney(r.tax)}</div>
      <div>Cost of goods sold: <b>{fmtMoney(r.cogs)}</b></div>
      {#if r.grossProfit !== null}<div>Gross profit: <b>{fmtMoney(r.grossProfit)}</b> <span class="muted">(net sales − cost of goods; not net profit)</span></div>
      {:else}<div class="err">Gross profit cannot be calculated reliably: {r.uncostedLines} sold line(s) have no purchase cost.</div>{/if}
      {#if r.refundedCount}<div class="muted">Refunded: {r.refundedCount} sale(s), {fmtMoney(r.refundedTotal)} (excluded above)</div>{/if}
    </div>
    <h3>By payment method</h3>
    {#each Object.entries(r.byMethod) as [m, a]}<div class="between"><span>{METHODS[m] ?? m}</span><span>{fmtMoney(a)}</span></div>{/each}
    <h3>By category</h3>
    {#each Object.entries(r.byCategory) as [m, a]}<div class="between"><span>{m}</span><span>{fmtMoney(a)}</span></div>{/each}
    <h3>Best-selling products</h3>
    {#each [...r.byProduct].sort((a, b) => b.qtyMilli - a.qtyMilli).slice(0, 15) as l}<div class="between"><span>{l.name} ×{fmtQty(l.qtyMilli)}</span><span>{fmtMoney(l.revenue)}</span></div>{/each}
    <h3>Daily trend</h3>
    {#each r.trend as [d, a]}<div class="between"><span>{d}</span><span>{fmtMoney(a)}</span></div>{/each}
    <h3>Not sold in this period ({unsold.length})</h3>
    <p class="sub">{unsold.slice(0, 20).map((p) => p.name).join(', ') || 'None'}</p>
    <button class="btn" on:click={csv}>Export CSV</button>
  {/if}
</main>

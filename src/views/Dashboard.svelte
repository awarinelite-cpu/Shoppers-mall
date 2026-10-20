<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { report } from '../lib/repo';
  import { dayRange, fmtMoney, fmtQty, fmtDateTime } from '../lib/money';
  import { settings, go } from '../lib/stores';
  import Header from '../views/Header.svelte';

  const today = liveQuery(() => { const [f, t] = dayRange(0); return report(f, t); });
  const products = liveQuery(() => db.products.toArray());
  const recent = liveQuery(() => db.sales.orderBy('createdAt').reverse().limit(5).toArray());
  $: active = ($products ?? []).filter((p) => p.active);
  $: out = active.filter((p) => p.stockMilli <= 0).length;
  $: low = active.filter((p) => p.stockMilli > 0 && p.stockMilli <= p.lowThresholdMilli).length;
</script>
<Header title={$settings?.store_name || 'Provision POS'} canBack={false} />
<main>
  <div class="grid2">
    <button class="btn" on:click={() => go('/sale?scan=1')}>📷 Scan & sell</button>
    <button class="btn alt" on:click={() => go('/product/new')}>＋ Add product</button>
  </div>
  <h3>Today</h3>
  {#if $today}
    <div class="grid2">
      <div class="stat"><div class="l">Total sales</div><div class="v">{fmtMoney($today.totalSales)}</div></div>
      <div class="stat"><div class="l">Transactions</div><div class="v">{$today.saleCount}</div></div>
      <div class="stat"><div class="l">Items sold</div><div class="v">{fmtQty($today.itemsMilli)}</div></div>
      <div class="stat"><div class="l">Est. cost of goods</div><div class="v">{fmtMoney($today.cogs)}</div></div>
    </div>
    <div class="stat"><div class="l">Est. gross profit</div>
      <div class="v">{$today.grossProfit === null ? 'Unavailable – some items have no purchase cost' : fmtMoney($today.grossProfit)}</div></div>
  {/if}
  <h3>Stock</h3>
  <div class="grid3">
    <div class="stat"><div class="l">In stock</div><div class="v">{active.length - out}</div></div>
    <div class="stat"><div class="l">Low</div><div class="v">{low}</div></div>
    <div class="stat"><div class="l">Out</div><div class="v">{out}</div></div>
  </div>
  <div class="grid2">
    <button class="btn alt" on:click={() => go('/stock')}>View stock</button>
    <button class="btn alt" on:click={() => go('/reports')}>Reports</button>
  </div>
  <h3>Recent sales</h3>
  {#if !$recent?.length}<p class="empty">No sales yet. Tap “Scan & sell” to make your first sale.</p>{/if}
  {#each $recent ?? [] as s (s.id)}
    <div class="item" on:click={() => go('/receipt/' + s.id)} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && go('/receipt/' + s.id)}>
      <div class="t">{s.receiptNo} · {fmtMoney(s.total)}</div><div class="sub">{fmtDateTime(s.createdAt)}{s.status === 'REFUNDED' ? ' · refunded' : ''}</div>
    </div>
  {/each}
</main>

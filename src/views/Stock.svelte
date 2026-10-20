<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { fmtMoney, fmtQty, lineTotal, UNITS } from '../lib/money';
  import { go } from '../lib/stores';
  import Header from './Header.svelte';
  const products = liveQuery(() => db.products.orderBy('name').toArray());
  let q = '', filter = 'ALL';
  $: active = ($products ?? []).filter((p) => p.active);
  $: list = active.filter((p) => (!q.trim() || p.name.toLowerCase().includes(q.toLowerCase()) || p.barcode === q.trim() || p.category.toLowerCase().includes(q.toLowerCase())) &&
    (filter === 'LOW' ? p.stockMilli > 0 && p.stockMilli <= p.lowThresholdMilli : filter === 'OUT' ? p.stockMilli <= 0 : true));
  $: costValue = active.reduce((a, p) => a + (p.costKobo != null ? lineTotal(p.costKobo, Math.max(p.stockMilli, 0)) : 0), 0);
  $: saleValue = active.reduce((a, p) => a + lineTotal(p.priceKobo, Math.max(p.stockMilli, 0)), 0);
  $: missing = active.filter((p) => p.costKobo == null).length;
</script>
<Header title="Stock" canBack={false}><button on:click={() => go('/movements')}>History</button></Header>
<main>
  <div class="card">
    <div>Stock value at cost: <b>{fmtMoney(costValue)}</b>{missing ? ` (${missing} products have no cost)` : ''}</div>
    <div>Stock value at selling price: <b>{fmtMoney(saleValue)}</b></div>
  </div>
  <input bind:value={q} placeholder="Search stock" />
  <div class="chips">{#each [['ALL', 'All'], ['LOW', 'Low stock'], ['OUT', 'Out of stock']] as [k, l]}<button class="chip" class:on={filter === k} on:click={() => (filter = k)}>{l}</button>{/each}</div>
  {#if !list.length}<p class="empty">Nothing to show.</p>{/if}
  {#each list as p (p.id)}
    <div class="item between" style="align-items:center">
      <div on:click={() => go('/product/' + p.id)} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && go('/product/' + p.id)}>
        <div class="t">{p.name}</div>
        <div class="sub">{fmtQty(p.stockMilli)} {UNITS[p.unit]}{p.stockMilli <= 0 ? ' · OUT OF STOCK' : p.stockMilli <= p.lowThresholdMilli ? ` · LOW (alert at ${fmtQty(p.lowThresholdMilli)})` : ''}</div>
      </div>
      <button class="sm" on:click={() => go('/adjust/' + p.id)}>Adjust</button>
    </div>
  {/each}
</main>

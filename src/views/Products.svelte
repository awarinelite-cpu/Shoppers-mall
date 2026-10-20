<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { findByCode } from '../lib/repo';
  import { fmtMoney, fmtQty, UNITS } from '../lib/money';
  import { go } from '../lib/stores';
  import Header from './Header.svelte';
  import Scanner from './Scanner.svelte';
  const products = liveQuery(() => db.products.orderBy('name').toArray());
  let q = '', showInactive = false, scanning = false;
  $: list = ($products ?? []).filter((p) => (showInactive || p.active) && (!q.trim() || p.name.toLowerCase().includes(q.toLowerCase()) ||
    p.barcode === q.trim() || p.altBarcode === q.trim() || p.internalCode.toLowerCase().includes(q.toLowerCase()) || p.category.toLowerCase().includes(q.toLowerCase())));
  async function found(code: string) { const p = await findByCode(code); go(p ? '/product/' + p.id : '/product/new?barcode=' + encodeURIComponent(code)); }
</script>
<Header title="Products" canBack={false}>
  <button on:click={() => (scanning = true)} aria-label="Scan">📷</button><button on:click={() => go('/product/new')} aria-label="Add">＋</button>
</Header>
<main>
  <input bind:value={q} placeholder="Search name, barcode, code, category" />
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" style="width:auto" bind:checked={showInactive} /> Show deactivated</label>
  {#if !list.length}<p class="empty">{$products?.length ? 'No matching products.' : 'No products yet. Tap ＋ to add your first product.'}</p>{/if}
  {#each list as p (p.id)}
    <div class="item" role="button" tabindex="0" on:click={() => go('/product/' + p.id)} on:keydown={(e) => e.key === 'Enter' && go('/product/' + p.id)}>
      <div class="t">{p.name}{p.active ? '' : ' (deactivated)'}</div>
      <div class="sub">{fmtMoney(p.priceKobo)} · {fmtQty(p.stockMilli)} {UNITS[p.unit]} · {p.barcode ?? p.internalCode}</div>
    </div>
  {/each}
</main>
{#if scanning}<Scanner mode="pick" onCode={found} onClose={() => (scanning = false)} />{/if}

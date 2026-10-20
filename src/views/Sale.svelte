<script lang="ts">
  import { onMount } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { findByCode } from '../lib/repo';
  import { fmtMoney } from '../lib/money';
  import { route } from '../lib/stores';
  import { go } from '../lib/stores';
  import type { Product } from '../lib/db';
  import Header from './Header.svelte';
  import Scanner from './Scanner.svelte';

  // Price check only: scan (or search) an item to see its name and price. No cart, no quantity, no stock rules.
  const products = liveQuery(() => db.products.toArray());
  let query = '', scanning = false, shown: Product | null = null;
  onMount(() => { if ($route.includes('scan=1')) { scanning = true; history.replaceState(null, '', '#/sale'); } });

  $: matches = query.trim() ? ($products ?? []).filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.barcode === query.trim() ||
      p.internalCode.toLowerCase() === query.trim().toLowerCase()).slice(0, 8) : [];

  async function onScan(code: string) {
    const p = await findByCode(code);
    if (!p) { shown = null; return { status: 'Not registered: ' + code, notFound: true }; }
    shown = p;
    return { status: `${p.name} · ${fmtMoney(p.priceKobo)}` };
  }
</script>

<Header title="Check price" canBack={false} />
<main>
  <button class="btn" on:click={() => (scanning = true)}>📷 Scan item</button>
  <input bind:value={query} placeholder="Or search by name" />
  {#if matches.length}
    <div class="card">
      {#each matches as p (p.id)}
        <div class="item" role="button" tabindex="0" on:click={() => { shown = p; query = ''; }} on:keydown={(e) => { if (e.key === 'Enter') { shown = p; query = ''; } }}>
          <div class="t">{p.name}</div><div class="sub">{fmtMoney(p.priceKobo)}</div>
        </div>
      {/each}
    </div>
  {/if}

  {#if shown}
    <div class="card" style="text-align:center;padding:24px 12px">
      <div class="t" style="font-size:1.2rem">{shown.name}</div>
      <div class="total" style="font-size:2.4rem;margin-top:8px">{fmtMoney(shown.priceKobo)}</div>
    </div>
  {:else}
    <p class="empty">Tap “Scan item” to see an item’s price.</p>
  {/if}
</main>

{#if scanning}
  <Scanner mode="sale" onCode={onScan} onClose={() => (scanning = false)}
    onRegister={(c) => { scanning = false; go('/product/new?barcode=' + encodeURIComponent(c)); }} />
{/if}

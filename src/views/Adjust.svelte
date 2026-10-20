<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { adjustStock } from '../lib/repo';
  import { parseQty, parseMoney, fmtQty, UNITS } from '../lib/money';
  import { back, safe, toast } from '../lib/stores';
  import Header from './Header.svelte';
  export let id: number;
  const p = liveQuery(() => db.products.get(id));
  const types: [string, string][] = [['RECEIVED', 'Goods received (+)'], ['DAMAGED', 'Damaged (−)'], ['EXPIRED', 'Expired (−)'], ['LOSS', 'Loss / missing (−)'],
    ['CORRECTION_ADD', 'Count correction (+)'], ['CORRECTION_SUB', 'Count correction (−)']];
  let type = 'RECEIVED', qty = '', cost = '', note = '';
  async function save() {
    const q = parseQty(qty), c = cost.trim() ? parseMoney(cost) : null;
    if (!q) return toast('Enter a valid quantity');
    if (cost.trim() && c === null) return toast('Invalid cost');
    {
      const plus = type === 'RECEIVED' || type === 'CORRECTION_ADD';
      const r = await safe(() => adjustStock(id, plus ? q : -q, type.startsWith('CORRECTION') ? 'CORRECTION' : type, types.find((t) => t[0] === type)![1], note, c));
      if (r !== undefined) { toast('Stock updated'); back(); }
    }
  }
</script>
<Header title="Adjust stock" />
<main>
  {#if $p}
    <h2>{$p.name}</h2><p>Current stock: <b>{fmtQty($p.stockMilli)} {UNITS[$p.unit]}</b></p>
    <label for="t">Reason</label><select id="t" bind:value={type}>{#each types as [k, l]}<option value={k}>{l}</option>{/each}</select>
    <label for="q">Quantity ({UNITS[$p.unit]})</label><input id="q" bind:value={qty} inputmode="decimal" />
    {#if type === 'RECEIVED'}<label for="c">New purchase cost per unit ₦ (optional)</label><input id="c" bind:value={cost} inputmode="decimal" />{/if}
    <label for="n">Reference / notes (optional)</label><input id="n" bind:value={note} />
    <button class="btn" on:click={save}>Save adjustment</button>
  {/if}
</main>

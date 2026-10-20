<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '../lib/db';
  import { saveProduct } from '../lib/repo';
  import { parseMoney, parseQty, fmtQty, moneyInput, fmtDate, parseDate, UNITS } from '../lib/money';
  import { back, toast, safe, S, guard } from '../lib/stores';
  import Header from './Header.svelte';
  import Scanner from './Scanner.svelte';

  export let id: number | null;
  export let barcode = '';
  let loaded = id === null;
  let name = '', alt = '', internal = '', category = '', cost = '', price = '', stock = '0', low = S('low_default', '5'), unit = 'PIECE';
  let supplier = '', description = '', expiry = '', scanning = false;

  onMount(async () => {
    if (id === null) return;
    const p = await db.products.get(id); if (!p) return toast('Product not found');
    name = p.name; barcode = p.barcode ?? ''; alt = p.altBarcode ?? ''; internal = p.internalCode; category = p.category;
    cost = p.costKobo != null ? moneyInput(p.costKobo) : ''; price = moneyInput(p.priceKobo); low = fmtQty(p.lowThresholdMilli); unit = p.unit;
    supplier = p.supplier ?? ''; description = p.description ?? ''; expiry = p.expiryAt ? fmtDate(p.expiryAt) : ''; loaded = true;
  });

  async function save() {
    const pr = parseMoney(price), c = cost.trim() ? parseMoney(cost) : null, st = parseQty(stock), lw = parseQty(low);
    const ex = expiry.trim() ? parseDate(expiry) : null;
    if (!name.trim()) return toast('Enter the product name');
    if (pr === null) return toast('Enter a valid selling price');
    if (cost.trim() && c === null) return toast('Purchase cost is invalid');
    if (st === null || lw === null) return toast('Stock quantities are invalid');
    if (expiry.trim() && ex === null) return toast('Expiry date must be yyyy-mm-dd');
    const doSave = async () => { const r = await safe(() => saveProduct({ id: id ?? undefined, name, barcode, altBarcode: alt, internalCode: internal, category: category.trim(),
      costKobo: c, priceKobo: pr, stockMilli: id === null ? st : 0, lowThresholdMilli: lw, unit, supplier: supplier || undefined, description: description || undefined, expiryAt: ex }));
      if (r !== undefined) { toast('Product saved'); back(); } };
    if (id === null) await doSave(); else await guard(doSave);
  }
</script>
<Header title={id === null ? 'Add product' : 'Edit product'} />
<main>
  {#if !loaded}<p class="empty">Loading…</p>{:else}
    <label for="n">Product name *</label><input id="n" bind:value={name} />
    <label for="bc">Barcode (leave empty to use an internal code)</label>
    <div class="row"><input id="bc" bind:value={barcode} inputmode="numeric" /><button class="sm fit" style="padding:14px" on:click={() => (scanning = true)}>📷</button></div>
    <label for="al">Alternative barcode (optional)</label><input id="al" bind:value={alt} />
    <label for="ic">Internal code (auto if empty)</label><input id="ic" bind:value={internal} />
    <label for="ca">Category (e.g. Grains, Drinks)</label><input id="ca" bind:value={category} />
    <div class="row"><div><label for="co">Purchase cost ₦</label><input id="co" bind:value={cost} inputmode="decimal" /></div>
      <div><label for="pr">Selling price ₦ *</label><input id="pr" bind:value={price} inputmode="decimal" /></div></div>
    <label for="un">Unit</label><select id="un" bind:value={unit}>{#each Object.entries(UNITS) as [k, v]}<option value={k}>{v}</option>{/each}</select>
    <div class="row">
      {#if id === null}<div><label for="st">Opening stock</label><input id="st" bind:value={stock} inputmode="decimal" /></div>{/if}
      <div><label for="lo">Low-stock level</label><input id="lo" bind:value={low} inputmode="decimal" /></div>
    </div>
    {#if id !== null}<p class="hint">Change stock with Stock → Adjust so the history stays correct.</p>{/if}
    <label for="su">Supplier (optional)</label><input id="su" bind:value={supplier} />
    <label for="ex">Expiry date yyyy-mm-dd (optional)</label><input id="ex" bind:value={expiry} placeholder="2027-06-30" />
    <label for="de">Description (optional)</label><textarea id="de" rows="2" bind:value={description}></textarea>
    <button class="btn" on:click={save}>Save product</button>
  {/if}
</main>
{#if scanning}<Scanner mode="pick" onCode={async (c) => { barcode = c; }} onClose={() => (scanning = false)} />{/if}

<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { setActive } from '../lib/repo';
  import { fmtMoney, fmtQty, fmtDate, fmtDateTime, UNITS } from '../lib/money';
  import { go, confirmBox, toast } from '../lib/stores';
  import Header from './Header.svelte';
  import MovementRow from './MovementRow.svelte';
  export let id: number;
  const p = liveQuery(() => db.products.get(id));
  const moves = liveQuery(() => db.movements.where('productId').equals(id).reverse().sortBy('createdAt'));
  async function toggle() {
    if ($p?.active) { if (!(await confirmBox('Deactivate product?', 'It will no longer be sellable. Old receipts are not affected.', 'Deactivate'))) return; await setActive(id, false); toast('Product deactivated'); }
    else { await setActive(id, true); toast('Product activated'); }
  }
</script>
<Header title={$p?.name ?? 'Product'} />
<main>
  {#if $p}
    <div class="card">
      <div class="total">{fmtMoney($p.priceKobo)}</div>
      <div>Purchase cost: {$p.costKobo != null ? fmtMoney($p.costKobo) : 'not set'}</div>
      <div>Stock: <b>{fmtQty($p.stockMilli)} {UNITS[$p.unit]}</b> (low at {fmtQty($p.lowThresholdMilli)})</div>
      <div>Barcode: {$p.barcode ?? '-'} · Code: {$p.internalCode}{$p.altBarcode ? ' · Alt: ' + $p.altBarcode : ''}</div>
      <div>Category: {$p.category || '-'} · Supplier: {$p.supplier ?? '-'}</div>
      {#if $p.expiryAt}<div>Expiry: {fmtDate($p.expiryAt)}</div>{/if}
      {#if $p.description}<div>{$p.description}</div>{/if}
      <div class="sub">Created {fmtDateTime($p.createdAt)} · updated {fmtDateTime($p.updatedAt)}{$p.active ? '' : ' · DEACTIVATED'}</div>
    </div>
    <div class="row">
      <button class="btn" on:click={() => go('/product/' + id + '/edit')}>Edit</button>
      <button class="btn alt" on:click={() => go('/adjust/' + id)}>Adjust stock</button>
    </div>
    <button class="btn alt" on:click={toggle}>{$p.active ? 'Deactivate' : 'Activate'}</button>
    <h3>Transaction history</h3>
    {#if !$moves?.length}<p class="empty">No movements yet.</p>{/if}
    {#each $moves ?? [] as m (m.id)}<MovementRow {m} />{/each}
  {/if}
</main>

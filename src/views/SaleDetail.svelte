<script lang="ts">
  import { liveQuery } from 'dexie';
  import { saleDetail, refund } from '../lib/repo';
  import { db } from '../lib/db';
  import { receiptText } from '../lib/receipt';
  import { settings, go, promptBox, safe, toast } from '../lib/stores';
  import Header from './Header.svelte';
  export let id: number;
  // re-read when sales change (e.g. after a refund)
  const d = liveQuery(async () => { await db.sales.get(id); return saleDetail(id); });
  $: text = $d && $settings ? receiptText($settings, $d.sale, $d.items, $d.payments) : '';

  async function share() {
    try { if (navigator.share) await navigator.share({ title: 'Receipt ' + $d?.sale.receiptNo, text }); else { await navigator.clipboard.writeText(text); toast('Receipt copied'); } }
    catch (e: any) { if (e?.name !== 'AbortError') toast('Could not share'); }
  }
  async function doRefund() {
    const reason = await promptBox('Refund this sale?', 'Reason', '', false, 'The sale stays in history marked REFUNDED and all items return to stock.');
    if (reason === null) return;
    const r = await safe(() => refund(id, reason)); if (r !== undefined) toast('Sale refunded and stock restored');
  }
</script>
<Header title="Receipt" />
<main>
  {#if $d}
    {#if $d.sale.status === 'COMPLETED'}<p style="color:var(--p);font-weight:700">✓ Sale completed</p>{/if}
    <div class="card receipt-wrap"><pre class="receipt">{text}</pre></div>
    <button class="btn" on:click={share}>Share receipt</button>
    <button class="btn alt" on:click={() => window.print()}>Print receipt</button>
    {#if $d.sale.status === 'COMPLETED'}<button class="btn danger" on:click={doRefund}>Refund / reverse sale</button>{/if}
    <button class="btn alt" on:click={() => go('/sale')}>New sale</button>
  {:else}<p class="empty">Sale not found.</p>{/if}
</main>

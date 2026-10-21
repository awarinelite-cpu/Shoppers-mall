<script lang="ts">
  import { liveQuery } from 'dexie';
  import { report } from '../lib/repo';
  import { dayRange, fmtMoney, fmtQty } from '../lib/money';
  import { settings, go } from '../lib/stores';
  import { syncStatus, syncLabel, pendingCount } from '../lib/sync';
  import Header from '../views/Header.svelte';

  const today = liveQuery(() => { const [f, t] = dayRange(0); return report(f, t); });
  const pending = liveQuery(() => pendingCount());
  $: cloud = $settings?.sync_enabled === '1' ? syncLabel($syncStatus, $pending ?? 0) : '';
</script>
<Header title={$settings?.store_name || 'Provision POS'} canBack={false} />
<main>
  {#if cloud}<button class="sm" style="align-self:flex-end;margin-bottom:6px" on:click={() => go('/settings')}>☁ {cloud}</button>{/if}
  <div class="grid2">
    <button class="btn" on:click={() => go('/sale?scan=1')}>📷 Scan & sell</button>
    <button class="btn alt" on:click={() => go('/product/new')}>＋ Add product</button>
  </div>
  <h3>Today</h3>
  {#if $today}
    <div class="grid2">
      <div class="stat"><div class="l">Total sales</div><div class="v">{fmtMoney($today.totalSales)}</div></div>
      <div class="stat"><div class="l">Transactions</div><div class="v">{$today.saleCount}</div></div>
    </div>
    <div class="stat"><div class="l">Items sold</div><div class="v">{fmtQty($today.itemsMilli)}</div></div>
  {/if}
</main>

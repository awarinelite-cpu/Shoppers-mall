<script lang="ts">
  import { liveQuery } from 'dexie';
  import { settings, go } from '../lib/stores';
  import { syncStatus, syncLabel, pendingCount } from '../lib/sync';
  import Header from '../views/Header.svelte';

  const pending = liveQuery(() => pendingCount());
  $: cloud = $settings?.sync_enabled === '1' ? syncLabel($syncStatus, $pending ?? 0) : '';
</script>
<Header title={$settings?.store_name || 'Provision POS'} canBack={false} />
<main>
  {#if cloud}<button class="sm" style="align-self:flex-end;margin-bottom:6px" on:click={() => go('/settings')}>☁ {cloud}</button>{/if}
  <div class="grid2">
    <button class="btn" on:click={() => go('/sale?scan=1')}>📷 Scan price</button>
    <button class="btn alt" on:click={() => go('/product/new')}>＋ Add product</button>
  </div>
</main>

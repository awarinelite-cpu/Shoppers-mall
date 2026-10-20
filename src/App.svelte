<script lang="ts">
  import { settings, route, go, toastMsg, dialog } from './lib/stores';
  import Dialog from './views/Dialog.svelte';
  import Setup from './views/Setup.svelte';
  import Dashboard from './views/Dashboard.svelte';
  import Sale from './views/Sale.svelte';
  import Checkout from './views/Checkout.svelte';
  import Products from './views/Products.svelte';
  import ProductForm from './views/ProductForm.svelte';
  import ProductDetail from './views/ProductDetail.svelte';
  import Stock from './views/Stock.svelte';
  import Adjust from './views/Adjust.svelte';
  import Movements from './views/Movements.svelte';
  import History from './views/History.svelte';
  import SaleDetail from './views/SaleDetail.svelte';
  import Reports from './views/Reports.svelte';
  import Settings from './views/Settings.svelte';
  import More from './views/More.svelte';
  import Cover from './views/Cover.svelte';
  let started = false;
  function start() { started = true; if (location.hash && location.hash !== '#/') go('/'); }

  $: [path, query] = $route.split('?');
  $: seg = path.split('/').filter(Boolean);
  $: q = new URLSearchParams(query ?? '');
  $: view = seg[0] ?? 'home';
  $: id = Number(seg[1]);
  $: tab = ['home', 'sale', 'products', 'stock', 'more'].includes(view) && seg.length <= 1;
  const tabs = [['/', '🏠', 'Home', 'home'], ['/sale', '🛒', 'Sale', 'sale'], ['/products', '📦', 'Products', 'products'], ['/stock', '📊', 'Stock', 'stock'], ['/more', '☰', 'More', 'more']];
</script>

{#if $settings === undefined}
  <p class="empty">Loading…</p>
{:else if !started}
  <Cover onStart={start} />
{:else if $settings.setup_done !== '1'}
  <Setup />
{:else}
  <div class="shell">
    {#key $route}
      {#if view === 'home'}<Dashboard />
      {:else if view === 'sale'}<Sale />
      {:else if view === 'checkout'}<Checkout />
      {:else if view === 'products'}<Products />
      {:else if view === 'product' && seg[1] === 'new'}<ProductForm id={null} barcode={q.get('barcode') ?? ''} />
      {:else if view === 'product' && seg[2] === 'edit'}<ProductForm {id} barcode="" />
      {:else if view === 'product'}<ProductDetail {id} />
      {:else if view === 'stock'}<Stock />
      {:else if view === 'adjust'}<Adjust {id} />
      {:else if view === 'movements'}<Movements />
      {:else if view === 'history'}<History />
      {:else if view === 'receipt'}<SaleDetail {id} />
      {:else if view === 'reports'}<Reports />
      {:else if view === 'settings'}<Settings />
      {:else if view === 'more'}<More />
      {:else}<Dashboard />{/if}
    {/key}
    {#if tab}
      <nav class="tabs">
        {#each tabs as [href, icon, label, v]}
          <a href={'#' + href} class:on={view === v}><span>{icon}</span>{label}</a>
        {/each}
      </nav>
    {/if}
  </div>
{/if}
<Dialog />
{#if $toastMsg}<div class="toast" role="status">{$toastMsg}</div>{/if}

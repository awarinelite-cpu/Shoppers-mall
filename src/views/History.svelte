<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { fmtMoney, fmtDateTime, parseDate, METHODS } from '../lib/money';
  import { go } from '../lib/stores';
  import Header from './Header.svelte';
  const sales = liveQuery(() => db.sales.orderBy('createdAt').reverse().toArray());
  let q = '', method = 'ALL', date = '';
  $: day = date.trim() ? parseDate(date) : null;
  $: list = ($sales ?? []).filter((s) => (!q.trim() || s.receiptNo.toLowerCase().includes(q.toLowerCase())) && (method === 'ALL' || s.methods.split(',').includes(method)) &&
    (day === null || (s.createdAt >= day && s.createdAt < day + 86_400_000)));
</script>
<Header title="Sales history" />
<main>
  <input bind:value={q} placeholder="Search receipt number" />
  <label for="d">Date (optional)</label><input id="d" type="date" bind:value={date} />
  <div class="chips">{#each [['ALL', 'All'], ...Object.entries(METHODS)] as [k, l]}<button class="chip" class:on={method === k} on:click={() => (method = k)}>{l}</button>{/each}</div>
  {#if !list.length}<p class="empty">No sales found.</p>{/if}
  {#each list as s (s.id)}
    <div class="item" role="button" tabindex="0" on:click={() => go('/receipt/' + s.id)} on:keydown={(e) => e.key === 'Enter' && go('/receipt/' + s.id)}>
      <div class="t">{s.receiptNo} · {fmtMoney(s.total)}</div>
      <div class="sub">{fmtDateTime(s.createdAt)} · {s.methods.split(',').map((m) => METHODS[m] ?? m).join(', ')} · {s.paymentStatus}{s.status === 'REFUNDED' ? ' · REFUNDED' : ''}</div>
    </div>
  {/each}
</main>

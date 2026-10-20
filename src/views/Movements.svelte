<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import Header from './Header.svelte';
  import MovementRow from './MovementRow.svelte';
  const moves = liveQuery(() => db.movements.orderBy('createdAt').reverse().limit(500).toArray());
</script>
<Header title="Stock movements" />
<main>
  {#if !$moves?.length}<p class="empty">No stock movements yet.</p>{/if}
  {#each $moves ?? [] as m (m.id)}<MovementRow {m} />{/each}
</main>

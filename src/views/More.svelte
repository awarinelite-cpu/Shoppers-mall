<script lang="ts">
  import { go } from '../lib/stores';
  import Header from './Header.svelte';
  const items: [string, string][] = [['/reports', '📈 Reports'], ['/history', '🧾 Sales history'], ['/movements', '🔁 Stock movement history'], ['/settings', '⚙ Settings & backup']];
</script>
<Header title="More" canBack={false} />
<main>{#each items as [href, label]}<div class="item" role="button" tabindex="0" on:click={() => go(href)} on:keydown={(e) => e.key === 'Enter' && go(href)}><div class="t">{label}</div></div>{/each}</main>

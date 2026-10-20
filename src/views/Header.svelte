<script lang="ts">
  import { back } from '../lib/stores';
  export let title: string;
  export let canBack = true;
</script>
<header class="bar">
  {#if canBack}<button on:click={back} aria-label="Back">←</button>{/if}
  <h1>{title}</h1>
  <slot />
</header>

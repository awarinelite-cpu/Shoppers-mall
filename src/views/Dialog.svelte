<script lang="ts">
  import { dialog } from '../lib/stores';
  let val = '';
  $: if ($dialog) val = $dialog.value ?? '';
  function close(v: any) { const d = $dialog; dialog.set(null); d?.resolve(v); }
</script>

{#if $dialog}
  <div class="overlay" on:click|self={() => close($dialog?.kind === 'confirm' ? false : null)} role="presentation">
    <div class="modal" role="dialog" aria-modal="true">
      <h3>{$dialog.title}</h3>
      {#if $dialog.text}<p>{$dialog.text}</p>{/if}
      {#if $dialog.kind === 'prompt'}
        <label for="dv">{$dialog.label}</label>
        <!-- svelte-ignore a11y-autofocus -->
        <input id="dv" bind:value={val} inputmode={$dialog.number ? 'decimal' : 'text'} autofocus />
      {/if}
      <div class="row">
        <button class="btn alt" on:click={() => close($dialog?.kind === 'confirm' ? false : null)}>Cancel</button>
        <button class="btn" on:click={() => close($dialog?.kind === 'confirm' ? true : val)}>{$dialog.ok}</button>
      </div>
    </div>
  </div>
{/if}

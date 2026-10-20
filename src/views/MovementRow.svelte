<script lang="ts">
  import type { Movement } from '../lib/db';
  import { fmtQty, fmtDateTime } from '../lib/money';
  export let m: Movement;
</script>
<div class="item" style="cursor:default">
  <div class="t">{m.productName}: {m.changeMilli > 0 ? '+' : ''}{fmtQty(m.changeMilli)} <span class="muted">({m.type})</span></div>
  <div class="sub">{fmtQty(m.prevMilli)} → {fmtQty(m.newMilli)} · {fmtDateTime(m.createdAt)}{m.reason ? ' · ' + m.reason : ''}{m.note ? ' · ' + m.note : ''}</div>
</div>

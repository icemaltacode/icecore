<script setup>
/* What came back from a graded exercise's query: the grid, plus the three things that are
 * not a grid - nothing run yet, a statement with no rows, an error.
 *
 * The table itself is `DataGrid`, shared with the Playground's result and browse panes. It
 * used to draw its own, and the moment there was a second grid in the app that became two
 * renderers that had to agree about nulls and alignment by coincidence. See DataGrid for
 * why that matters more than it sounds like it does.
 */
import DataGrid from './DataGrid.vue';

defineProps({ result: Object, error: String, limit: { type: Number, default: 100 } });
</script>

<template>
  <div class="grid-wrap">
    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="!result" class="muted">No query run yet.</p>
    <p v-else-if="!result.fields.length" class="muted">
      Statement ran successfully<span v-if="result.affected != null"> ({{ result.affected }} rows affected)</span>.
    </p>
    <template v-else>
      <DataGrid :fields="result.fields" :rows="result.rows" :limit="limit" />
      <p class="muted count">
        Showing {{ Math.min(result.rows.length, limit) }} of {{ result.rows.length }} rows
      </p>
    </template>
  </div>
</template>

<style scoped>
.grid-wrap { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.muted { color: var(--ice-fg-muted); padding: 10px 12px; margin: 0; font-size: 13px; }
.count { border-top: 1px solid var(--ice-border); }
.err { color: var(--ice-bad); font-family: var(--ice-font-mono); font-size: 13px; padding: 10px 12px; margin: 0; white-space: pre-wrap; }
</style>

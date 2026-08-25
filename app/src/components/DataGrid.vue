<script setup>
/* A table of values, and nothing else.
 *
 * ONE RENDERER FOR EVERY GRID IN THE APP, and the reason is not code size. A student
 * browses `films`, runs a query against it, and compares the two by eye. If nulls render
 * one way in one pane and another in the other, or a numeric column is right-aligned in one
 * and not the other, they read that as the query having changed something. Sharing the
 * renderer is what makes the comparison trustworthy - the same argument as `Badge.vue`, and
 * the same failure if it is not shared.
 *
 * So the chrome stays outside. A result has a duration and might be a traceback; a browse
 * has a pager and two different counts; a graded exercise has a verdict. None of that is
 * here, because none of it is what a table of values looks like.
 *
 * ALIGNMENT IS PER COLUMN, FROM THE DATA. Numbers right, everything else left - that is how
 * a column of figures becomes readable at a glance, and it is decided once per column from
 * the first non-null value rather than per cell, or a null in a numeric column would sit on
 * the wrong side of it.
 */
import { computed } from 'vue';

const props = defineProps({
  /** Column names, in order. */
  fields: { type: Array, default: () => [] },
  /** Row objects keyed by field name. */
  rows: { type: Array, default: () => [] },
  /** How many to draw. The caller pages or windows; this one just stops. */
  limit: { type: Number, default: 200 },
  /** Row numbers down the left. Useful in a result, noise in a one-row preview. */
  numbered: Boolean,
  /** Where the numbering starts, so a pager's page 3 does not restart at 1. */
  offset: { type: Number, default: 0 },
});

const shown = computed(() => props.rows.slice(0, props.limit));

/* Postgres hands back dates and JSON as objects, and `String(v)` on those is either a
 * locale-dependent date or "[object Object]". Neither is what the value is. */
function text(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const numeric = computed(() => {
  const out = {};
  for (const f of props.fields) {
    const seen = shown.value.find(r => r[f] !== null && r[f] !== undefined);
    out[f] = seen ? typeof seen[f] === 'number' || typeof seen[f] === 'bigint' : false;
  }
  return out;
});
</script>

<template>
  <div class="datagrid">
    <table>
      <thead>
        <tr>
          <th v-if="numbered" class="rownum"></th>
          <th v-for="f in fields" :key="f" :class="{ num: numeric[f] }">{{ f }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in shown" :key="i">
          <td v-if="numbered" class="rownum">{{ offset + i + 1 }}</td>
          <td v-for="f in fields" :key="f"
              :class="{ isnull: row[f] === null || row[f] === undefined, num: numeric[f] }"
              :title="text(row[f])">{{ text(row[f]) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* Unique root class, for the reason SlidesStep spells out at length: Vue's scoped CSS
   reaches a child component's root, so a name another component also uses would get that
   component's geometry applied to this one. */
.datagrid { overflow: auto; flex: 1; min-height: 0; min-width: 0; }
table { border-collapse: collapse; width: 100%; font-family: var(--ice-font-mono); font-size: 13px; }
th, td { text-align: left; padding: 6px 12px; border-bottom: 1px solid var(--ice-border);
         white-space: nowrap; }
/* A wide cell is truncated rather than allowed to stretch the column past the pane - a
   1,200-character JSON value would otherwise push every other column out of sight. The
   full value is in the title, and selecting the cell still copies all of it. */
td { max-width: 40ch; overflow: hidden; text-overflow: ellipsis; }
th { position: sticky; top: 0; z-index: 1; background: var(--ice-bg-soft);
     color: var(--ice-primary-strong); font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.isnull { color: var(--ice-fg-muted); font-style: italic; }
/* Ordinals are furniture, not data: dimmed, narrow, and never selected as part of a row. */
.rownum { color: var(--ice-fg-muted); text-align: right; user-select: none;
          width: 1%; padding-right: 10px; font-size: 11px; }
</style>

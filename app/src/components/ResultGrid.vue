<script setup>
defineProps({ result: Object, error: String, limit: { type: Number, default: 100 } });
const cell = v => v === null || v === undefined ? 'NULL' : String(v);
</script>

<template>
  <div class="grid-wrap">
    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="!result" class="muted">No query run yet.</p>
    <p v-else-if="!result.fields.length" class="muted">
      Statement ran successfully<span v-if="result.affected != null"> ({{ result.affected }} rows affected)</span>.
    </p>
    <template v-else>
      <div class="scroll">
        <table>
          <thead>
            <tr><th v-for="f in result.fields" :key="f">{{ f }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in result.rows.slice(0, limit)" :key="i">
              <td v-for="f in result.fields" :key="f" :class="{ isnull: row[f] === null }">{{ cell(row[f]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted count">
        Showing {{ Math.min(result.rows.length, limit) }} of {{ result.rows.length }} rows
      </p>
    </template>
  </div>
</template>

<style scoped>
.grid-wrap { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.scroll { overflow: auto; flex: 1; min-height: 0; }
table { border-collapse: collapse; width: 100%; font-family: var(--ice-font-mono); font-size: 13px; }
th, td { text-align: left; padding: 6px 12px; border-bottom: 1px solid var(--ice-border); white-space: nowrap; }
th { position: sticky; top: 0; background: var(--ice-bg-soft); color: var(--ice-primary-strong); font-weight: 600; }
td.isnull { color: var(--ice-fg-muted); font-style: italic; }
.muted { color: var(--ice-fg-muted); padding: 10px 12px; margin: 0; font-size: 13px; }
.count { border-top: 1px solid var(--ice-border); }
.err { color: var(--ice-bad); font-family: var(--ice-font-mono); font-size: 13px; padding: 10px 12px; margin: 0; white-space: pre-wrap; }
</style>

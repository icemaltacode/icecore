<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { loadManifest, loadCourse } from './content.js';
import CodingExercise from './components/CodingExercise.vue';
import McqExercise from './components/McqExercise.vue';

const manifest = ref([]);
const course = ref(null);
const loading = ref(true);
const loadError = ref('');
const currentId = ref(null);

const flat = computed(() =>
  (course.value?.units || []).flatMap(u => u.exercises.map(e => ({ ...e, unitId: u.unit }))));
const current = computed(() => flat.value.find(e => e.id === currentId.value));
const index = computed(() => flat.value.findIndex(e => e.id === currentId.value));
const total = computed(() => flat.value.length);

const solved = ref(new Set());
const storeKey = computed(() => `ice-platform-progress:${course.value?.id || '?'}`);
watch(solved, v => localStorage.setItem(storeKey.value, JSON.stringify([...v])), { deep: true });
const doneCount = computed(() => flat.value.filter(e => solved.value.has(e.id)).length);

async function open(id) {
  loading.value = true; loadError.value = '';
  try {
    course.value = await loadCourse(id);
    solved.value = new Set(JSON.parse(localStorage.getItem(`ice-platform-progress:${id}`) || '[]'));
    currentId.value = flat.value[0]?.id ?? null;
    const url = new URL(location.href);
    url.searchParams.set('course', id);
    history.replaceState({}, '', url);
  } catch (e) {
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    manifest.value = await loadManifest();
    const wanted = new URLSearchParams(location.search).get('course');
    const pick = manifest.value.find(c => c.id === wanted) || manifest.value[0];
    if (!pick) throw new Error('No courses published - run npm run content');
    await open(pick.id);
  } catch (e) {
    loadError.value = e.message;
    loading.value = false;
  }
});

const markSolved = id => { solved.value = new Set([...solved.value, id]); };
const go = d => { const n = flat.value[index.value + d]; if (n) currentId.value = n.id; };
</script>

<template>
  <div class="shell">
    <aside>
      <div class="brand">
        <span class="dot"></span>
        <div>
          <strong>ICE Practice</strong>
          <small>{{ course?.title || 'Loading…' }}</small>
        </div>
      </div>

      <select v-if="manifest.length > 1" class="courses"
              :value="course?.id" @change="open($event.target.value)">
        <option v-for="c in manifest" :key="c.id" :value="c.id">
          {{ c.topic }} &mdash; {{ c.title }}
        </option>
      </select>

      <div class="progress" v-if="total">
        <div class="bar"><i :style="{ width: (doneCount / total * 100) + '%' }"></i></div>
        <small>{{ doneCount }} of {{ total }} complete</small>
      </div>

      <nav>
        <template v-for="u in course?.units || []" :key="u.unit">
          <h4>{{ u.label }}</h4>
          <button
            v-for="e in u.exercises" :key="e.id"
            class="navitem"
            :class="{ active: e.id === currentId, done: solved.has(e.id) }"
            @click="currentId = e.id">
            <span class="badge">{{ solved.has(e.id) ? '✓' : (e.type === 'mcq' ? '?' : 'SQL') }}</span>
            <span class="label">{{ e.title }}</span>
          </button>
        </template>
      </nav>
    </aside>

    <main>
      <div v-if="loadError" class="state error">
        <h2>Couldn't load the course</h2>
        <p>{{ loadError }}</p>
      </div>
      <div v-else-if="loading" class="state">
        <p>Loading…</p>
      </div>
      <component
        v-else-if="current"
        :is="current.type === 'mcq' ? McqExercise : CodingExercise"
        :key="current.id"
        :course-id="course.id"
        :exercise="current"
        :done="solved.has(current.id)"
        @solved="markSolved" />

      <footer v-if="total">
        <button class="btn ghost" :disabled="index <= 0" @click="go(-1)">Previous</button>
        <span class="muted">{{ index + 1 }} / {{ total }}</span>
        <button class="btn ghost" :disabled="index >= total - 1" @click="go(1)">Next</button>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: 272px 1fr; height: 100vh; }
aside { background: var(--ice-bg-soft); border-right: 1px solid var(--ice-border);
        display: flex; flex-direction: column; min-height: 0; }
.brand { display: flex; gap: 10px; align-items: center; padding: 18px 18px 14px; }
.brand small { display: block; color: var(--ice-fg-muted); font-size: 11px; }
.dot { width: 12px; height: 12px; border-radius: 3px; background: var(--ice-primary); flex: none; }
.courses { margin: 0 18px 12px; padding: 6px 8px; font: inherit; font-size: 12px;
           background: var(--ice-bg); color: var(--ice-fg);
           border: 1px solid var(--ice-border); border-radius: 8px; }
.progress { padding: 0 18px 14px; }
.bar { height: 4px; border-radius: 999px; background: var(--ice-bg); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--ice-primary); transition: width .3s; }
.progress small { color: var(--ice-fg-muted); font-size: 11px; display: block; margin-top: 6px; }
nav { overflow: auto; padding: 6px 10px 18px; flex: 1; min-height: 0; }
h4 { margin: 14px 8px 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
     color: var(--ice-fg-muted); }
.navitem { display: flex; gap: 9px; align-items: center; width: 100%; text-align: left;
           padding: 7px 8px; border-radius: 8px; border: 0; background: none; cursor: pointer;
           color: var(--ice-fg-muted); font: inherit; font-size: 13px; }
.navitem:hover { background: var(--ice-bg); color: var(--ice-fg); }
.navitem.active { background: var(--ice-bg); color: var(--ice-fg); box-shadow: inset 2px 0 0 var(--ice-primary); }
.navitem.done { color: var(--ice-fg); }
.badge { flex: none; min-width: 26px; height: 20px; padding: 0 4px; border-radius: 5px;
         display: grid; place-items: center; font-size: 9px; letter-spacing: .04em;
         font-family: var(--ice-font-mono); background: var(--ice-bg); border: 1px solid var(--ice-border); }
.navitem.done .badge { background: var(--ice-primary-soft); border-color: transparent; color: var(--ice-fg); }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

main { display: grid; grid-template-rows: 1fr auto; min-height: 0; }
.state { display: grid; place-content: center; text-align: center; color: var(--ice-fg-muted); gap: 6px; }
.state.error h2 { color: var(--ice-fg); margin: 0; font-size: 18px; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 12px;
         padding: 10px 16px; border-top: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.muted { color: var(--ice-fg-muted); font-size: 12px; }
</style>

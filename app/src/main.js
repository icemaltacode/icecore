import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { watchAppFrames } from './appframe.js';

createApp(App).mount('#app');

/* Embedded app frames size themselves to their app. Installed here rather than in a
 * component because the `::app` markup is injected with v-html from several of them and
 * owned by none - see appframe.js. Mounted first, so the observer is already watching when
 * the first prompt renders. */
watchAppFrames();

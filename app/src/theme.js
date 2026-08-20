/* Light or dark, and how that gets decided.
 *
 * Three choices - system, light, dark - but only two ever reach the CSS: `data-theme` on
 * <html> is always a concrete "light" or "dark". Resolving "system" here rather than in a
 * prefers-color-scheme media query means the dark palette is written once instead of twice,
 * and it keeps every rule in styles.css to a single selector.
 *
 * The same resolution runs as an inline script in index.html, before the bundle loads.
 * Without it the first paint is whatever :root says and the page visibly flips.
 */
import { ref, watch } from 'vue';

export const KEY = 'ice-theme';
export const CHOICES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const dark = matchMedia('(prefers-color-scheme: dark)');

export const theme = ref(
  CHOICES.some(c => c.value === localStorage.getItem(KEY)) ? localStorage.getItem(KEY) : 'system');

/** What `theme` actually resolves to right now: 'light' or 'dark'. */
export const resolved = ref('dark');

function apply() {
  resolved.value = theme.value === 'system' ? (dark.matches ? 'dark' : 'light') : theme.value;
  document.documentElement.dataset.theme = resolved.value;
}

watch(theme, v => { localStorage.setItem(KEY, v); apply(); });
// Only while they are on 'system': someone who has picked a side should keep it when the
// laptop crosses into night mode.
dark.addEventListener('change', () => { if (theme.value === 'system') apply(); });
apply();

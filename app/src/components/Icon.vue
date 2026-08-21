<script setup>
/* The handful of glyphs the player needs, inline rather than from a font.
 *
 * currentColor throughout, so an icon takes the colour of the button it sits in and follows
 * the theme without a second definition anywhere.
 */
defineProps({ name: String, size: { type: [Number, String], default: 15 } });

const PATHS = {
  // a bulb over its base
  hint: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3Z',
  // a large spark and a small one: the shorthand for a model answering
  ai: 'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z',
  answer: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  hidden: 'M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.3 8.3C3.7 9.9 2 12 2 12s3.6 6 10 6c1.4 0 2.6-.3 3.7-.7',
  copy: 'M9 9h10v12H9zM5 15V3h10v2',
  pin: 'M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  contents: 'M4 6h16M4 12h16M4 18h16',
  expand: 'M6 6l6 6-6 6M13 6l6 6-6 6',
  collapse: 'M18 6l-6 6 6 6M11 6l-6 6 6 6',
  // an arrow leaving a pane: the standard "opens elsewhere", not a plus or a window
  tab: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  // an arrow INTO a tray. The arrow alone is indistinguishable from a collapse or a
  // sort-descending at 15px; the tray under it is the half that says "to a file".
  download: 'M12 3v11M8 10l4 4 4-4M4 18v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2',
};
</script>

<template>
  <svg class="icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
       aria-hidden="true" focusable="false">
    <path :d="PATHS[name]" />
  </svg>
</template>

<style scoped>
.icon { flex: none; display: block; }
</style>

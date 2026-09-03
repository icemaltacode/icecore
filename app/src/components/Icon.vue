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
  // a chevron, pointing down. The affordance that says a control opens something rather
  // than does something - a triangle at this weight reads as Play, which the set already
  // has a glyph for.
  chevron: 'M6 9.5l6 6 6-6',
  // a body with a lens and the little bump of a viewfinder. The bump is what stops it
  // reading as a generic rounded rectangle with a circle in it at 14px.
  camera: 'M3 8.5a1.5 1.5 0 0 1 1.5-1.5h2.2l1.1-2h8.4l1.1 2h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5'
        + ' 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5ZM12 16.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4'
        + ' 0 0 0 0 6.8Z',
  // an arrow leaving a pane: the standard "opens elsewhere", not a plus or a window
  tab: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  // the same pane with the arrow coming back INTO it. Deliberately `tab` mirrored rather
  // than a different glyph: popping out and docking are one control in two states, and two
  // unrelated shapes would read as two unrelated actions.
  dock: 'M12 12h6M12 12V6M12 12l8-8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  // a cursor arrow over a small screen: driving someone else's. Not a hand and not a
  // gamepad - the thing being taken over is a pointer, and the frame is what says it is
  // somebody else's pointer rather than your own.
  remote: 'M3 5h18v10H3zM3 19h8M13 12l7 3-3 1-1 3-3-7Z',
  // a bubble with a tail. The tail is the whole glyph at 15px - without it this is `table`
  // without its rules.
  chat: 'M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  // an arrow INTO a tray. The arrow alone is indistinguishable from a collapse or a
  // sort-descending at 15px; the tray under it is the half that says "to a file".
  download: 'M12 3v11M8 10l4 4 4-4M4 18v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2',
  // a play triangle. Stroked rather than filled like the rest of the set, so it sits at the
  // same visual weight as its neighbours instead of reading as a heavier glyph.
  run: 'M7 4.5v15l13-7.5-13-7.5Z',
  // lines of prose on a page: a note, not a document icon and not a speech bubble
  notes: 'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M8 8h8M8 12h8M8 16h5',
  // which way the divider runs - the pane arrangement, not an action
  rows: 'M4 4h16v7H4zM4 13h16v7H4z',
  columns: 'M4 4h7v16H4zM13 4h7v16h-7z',
  // a lens with a handle. The handle points down-right, which is the direction every other
  // magnifier in every other toolbar points - the mirrored one reads as a different glyph.
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l4.5 4.5',
  // a grid with a heavier first row: a table, distinguishable from `rows` at 13px because
  // this one has a header and that one is two panes
  table: 'M4 5h16v14H4zM4 9.5h16M10 9.5V19M16 9.5V19',
  // two figures, the second behind and cropped. A single head-and-shoulders reads as
  // "account"; the second one is what makes it a group.
  people: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 '
        + '0-7 3.5 3.5 0 0 0 0 7M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  // a dial with two hands. The short hand is what says clock rather than target.
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3.5 2',
  // broadcast: a point with arcs radiating either side. Not a dot in a circle, which at
  // 14px is the record button on every piece of hardware anyone has ever used.
  live: 'M12 12h.01M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13'
      + 'M18.5 5.5a9 9 0 0 1 0 13',
  // three dots. Drawn as zero-length strokes with a round cap rather than as circles, so
  // they take the same stroke-width and the same colour as everything else in the set.
  more: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
  // a pencil, tip down-left, with the ferrule drawn as its own stroke. The ferrule is what
  // makes it a pencil rather than an arrow at 15px - without it the body is just a
  // diagonal, which is why the plain "slash" edit glyphs read as a share or a link.
  edit: 'M4 20l1-5L16 4a2.83 2.83 0 0 1 4 4L9 19l-5 1Z M13.5 6.5l4 4',
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

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { EditorState, Compartment, StateField, StateEffect } from '@codemirror/state';
import { EditorView, WidgetType, Decoration, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { python } from '@codemirror/lang-python';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/* CodeMirror's default highlight style is built for a light background, which was fine
 * while there was only one theme and less so now. Written in tokens instead: a
 * HighlightStyle emits ordinary CSS, so `var(--ice-syn-*)` resolves per theme and the
 * editor follows the rest of the app without being rebuilt. */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--ice-syn-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--ice-syn-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--ice-syn-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--ice-syn-comment)', fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: 'var(--ice-syn-operator)' },
  { tag: [tags.typeName, tags.function(tags.variableName)], color: 'var(--ice-syn-name)' },
]);

/* One editor, two languages. It was SqlEditor until module 2 needed a Python one, and the
 * only thing that differs is which CodeMirror language extension is installed - the
 * theming, the keymap and the Mod-Enter-to-run contract are the same editor. Two copies
 * would have drifted the moment either was touched. */
const LANGUAGES = { sql: () => sql({ dialect: PostgreSQL }), python: () => python() };

/* SOMEBODY ELSE'S CARET, drawn in this editor.
 *
 * A widget rather than a second selection, because a CodeMirror selection is a thing the user
 * can extend and type over, and this one belongs to a different person entirely. A widget is
 * inert by construction and cannot be confused with your own.
 *
 * The name is on it. An anonymous bar blinking in your editor while somebody drives is
 * unsettling in a way that the same bar labelled "Keith" is not - it is the difference
 * between something happening TO the screen and somebody being in the room.
 *
 * The position maps through document changes, which is what `mapPos` is for: the driver's
 * keystroke and the caret it left behind arrive as two facts, and without mapping the caret
 * would lag a character behind every letter typed.
 */
class Caret extends WidgetType {
  constructor(name) { super(); this.name = name; }
  eq(other) { return other.name === this.name; }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-peer';
    const bar = document.createElement('span');
    bar.className = 'cm-peer-bar';
    const tag = document.createElement('span');
    tag.className = 'cm-peer-name';
    tag.textContent = this.name;
    wrap.append(bar, tag);
    return wrap;
  }
  // It is not part of the text: ignoring events keeps clicks and selection behaving as if
  // the label were not there at all.
  ignoreEvent() { return true; }
}

const setPeer = StateEffect.define();
const peer = StateField.define({
  create: () => ({ pos: null, name: '' }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPeer)) return e.value;
    if (value.pos == null || !tr.docChanged) return value;
    return { ...value, pos: tr.changes.mapPos(value.pos, 1) };
  },
  provide: f => EditorView.decorations.compute([f], state => {
    const { pos, name } = state.field(f);
    // A stale position past the end of a shorter document draws nothing rather than throwing.
    if (pos == null || pos > state.doc.length) return Decoration.none;
    return Decoration.set([
      Decoration.widget({ widget: new Caret(name || 'Educator'), side: 1 }).range(pos),
    ]);
  }),
});

const props = defineProps({
  modelValue: String,
  language: { type: String, default: 'sql' },
  /* Read-only, for a student whose screen somebody else is driving. TWO PEOPLE TYPING INTO
   * ONE BUFFER is not a thing this can do - there is no merge here and there should not be
   * one - so while an educator is driving, the student watches. The band says so. */
  readonly: Boolean,
  /** Where somebody else's caret is, and whose. Null draws nothing. */
  peerAt: { type: Number, default: null },
  peerName: String,
});
const emit = defineEmits(['update:modelValue', 'run', 'cursor']);
const host = ref(null);
let view = null;
/* A compartment rather than a rebuild: control starts and stops mid-lesson, and recreating
 * the view would throw away the undo history and the scroll position each time. */
const editable = new Compartment();

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue || '',
      extensions: [
        editable.of(EditorView.editable.of(!props.readonly)),
        peer,
        lineNumbers(), history(), highlightActiveLine(),
        syntaxHighlighting(highlight, { fallback: true }),
        (LANGUAGES[props.language] || LANGUAGES.sql)(),
        keymap.of([
          { key: 'Mod-Enter', run: () => (emit('run'), true) },
          indentWithTab, ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.updateListener.of(u => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
          /* The caret travels separately from the text, and has to: a driver moving the
           * cursor without typing is still telling the other side where they are looking. */
          if (u.selectionSet || u.docChanged) emit('cursor', u.state.selection.main.head);
        }),
        // Chrome, gutters and selection are the editor's own furniture and CodeMirror
        // gives them light defaults; drive them from the tokens too.
        EditorView.theme({
          '&': { fontSize: '14px', height: '100%', color: 'var(--ice-fg)' },
          '.cm-scroller': { fontFamily: 'var(--ice-font-mono)', lineHeight: '1.6' },
          '&.cm-focused': { outline: 'none' },
          '.cm-gutters': {
            background: 'var(--ice-code-bg)', color: 'var(--ice-fg-muted)', border: '0',
          },
          '.cm-activeLine': { background: 'var(--ice-raise)' },
          '.cm-activeLineGutter': { background: 'var(--ice-raise)', color: 'var(--ice-fg)' },
          /* CARET-COLOR, NOT .cm-cursor, and the .cm-cursor rule below has never done
             anything. CodeMirror only draws its own cursor element when the `drawSelection`
             extension is loaded, and it is not - so what blinks here is the BROWSER's native
             caret, which takes `caret-color` and ignores border-left-color entirely. The
             native caret defaults to currentColor on the element it sits in, and .cm-content
             carries no colour of its own, so in dark mode it came out black on dark blue.
             Kept alongside so that adding drawSelection later does not reintroduce it. */
          '.cm-content': { caretColor: 'var(--ice-fg)' },
          /* ZERO WIDTH AND ZERO HEIGHT, so inserting it between two characters moves
             neither them nor the line. Both children are absolutely placed against it and
             measured in `em`, which is the only way to size a caret to the text when the
             thing it hangs off has no size of its own.

             The height was the bug: this was an inline-block of width 0 with the bar given
             `top: 0; bottom: 0`, and an empty inline-block is zero pixels tall - so the bar
             was drawn with no height at all and only the label ever appeared. `bottom: 0`
             against a zero-height box also put the label's foot on the baseline, which is
             why it sat across the code instead of above it. */
          '.cm-peer': {
            position: 'relative', display: 'inline-block', width: '0', height: '0',
            verticalAlign: 'baseline',
          },
          /* From just under the baseline to just over the ascender: the em box, near enough,
             which is where a caret belongs in a 1.6 line. IT BLINKS, because a static bar in
             a read-only editor reads as a decoration rather than as somebody typing - the
             whole point of it. CodeMirror's own 1.06s, so the two never look like different
             kinds of thing. */
          '.cm-peer-bar': {
            position: 'absolute', left: '-1px', bottom: '-.28em', height: '1.3em',
            width: '2px', borderRadius: '1px',
            background: 'var(--ice-drive-line)',
            animation: 'ice-peer-blink 1.06s steps(1) infinite',
          },
          /* Clear of the ascender, so it sits in the gap between lines rather than over the
             code. Overlapping the line above is what every editor with this feature does and
             is the right trade: the name is read once and the code is read continuously. */
          '.cm-peer-name': {
            position: 'absolute', left: '-2px', bottom: '1.12em', whiteSpace: 'nowrap',
            padding: '3px 8px', borderRadius: '6px 6px 6px 1px',
            fontSize: '10.5px', lineHeight: '1.25', fontWeight: '600',
            fontFamily: 'var(--ice-font-sans, inherit)',
            background: 'var(--ice-drive-line)', color: 'var(--ice-on-drive)',
            pointerEvents: 'none', userSelect: 'none',
            boxShadow: '0 1px 4px rgb(0 0 0 / .25)',
          },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ice-fg)' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
            background: 'var(--ice-primary-soft)',
          },
        }),
      ],
    }),
  });
});

/* THE CARET IS RE-ASSERTED AFTER EVERY DOCUMENT REPLACE, and that is what fixes it jumping
 * to the end of the exercise.
 *
 * An external change - which is every keystroke of somebody driving - arrives here as a
 * replacement of the WHOLE document, and `mapPos` through a whole-document replacement lands
 * on the end of the insertion. So the field faithfully mapped the caret to the last character
 * of the file on every letter typed. The prop carrying the true position had already arrived
 * by then, so re-applying it afterwards is both correct and free: whatever the driver last
 * said wins over whatever mapping inferred.
 *
 * `mapPos` still earns its place for a document this side edits itself, where nothing else
 * would keep the caret against moving text. */
const applyPeer = () => view?.dispatch({
  effects: setPeer.of({
    pos: props.peerAt == null ? null : Number(props.peerAt),
    name: props.peerName,
  }),
});
watch(() => [props.peerAt, props.peerName], applyPeer);

watch(() => props.readonly, ro => {
  view?.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!ro)) });
});

// external changes (moving to another step, or somebody driving) replace the whole document
watch(() => props.modelValue, v => {
  if (!view || v === view.state.doc.toString()) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v || '' } });
  applyPeer();   // see above: the replacement above would otherwise map it to the end
});

onBeforeUnmount(() => view?.destroy());
</script>

<template><div ref="host" class="editor"></div></template>

<style scoped>
.editor { height: 100%; overflow: auto; background: var(--ice-code-bg); }
</style>

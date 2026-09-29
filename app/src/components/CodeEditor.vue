<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { EditorState, Compartment, StateField, StateEffect } from '@codemirror/state';
import { EditorView, WidgetType, Decoration, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { linter, forceLinting } from '@codemirror/lint';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { python } from '@codemirror/lang-python';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags, highlightTree } from '@lezer/highlight';

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
/* WHAT EACH LANGUAGE OFFERS TO COMPLETE comes with it. SQL gets the exercise's tables and
 * columns - `schema`, read out of the dataset at build time - and its keywords in capitals,
 * which is how every query in the courses is written. Python completes its keywords, its
 * builtins and the names already written in the editor; it cannot know what the setup
 * defined or what a DataFrame has, and does not pretend to. */
const LANGUAGES = {
  sql: schema => sql({ dialect: PostgreSQL, upperCaseKeywords: true, schema: schema || undefined }),
  python: () => python(),
};

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

/* A SELECTION IS A CARET WITH AN ANCHOR, and both ends map through document changes for the
 * same reason the caret alone did: the driver's keystroke and the range it left behind arrive
 * as two facts, and an unmapped anchor lags a character behind every letter typed - which on
 * a highlight is not a lagging caret but a highlight that covers the wrong words.
 *
 * `anchor` is null for a plain caret, which is the ordinary case and the only one that
 * existed before. Where an educator has selected nothing there is nothing to shade. */
/* NEVER PAST THE END OF THE TEXT, on the way in or through a change. `mapPos` THROWS for a
 * position beyond the document it maps from, and a position that arrives from another
 * browser is only as current as that browser's text: an educator typing at the bottom and
 * then copying a shorter answer in left the caret at 333 in a 286-character document. From
 * then on every change threw inside this field, so the student's editor froze on the old
 * text for the rest of the session while every drive arrived. Drawing already declined a
 * stale position; storing and mapping one did not. The true position is re-applied after
 * each replacement anyway - see `applyPeer` - so clamping loses nothing. */
const within = (p, len) => (p == null ? null : Math.min(Math.max(0, p), len));
const setPeer = StateEffect.define();
const peer = StateField.define({
  create: () => ({ pos: null, anchor: null, name: '' }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setPeer)) {
        const len = tr.newDoc.length;
        return { ...e.value, pos: within(e.value.pos, len), anchor: within(e.value.anchor, len) };
      }
    }
    if (!tr.docChanged || (value.pos == null && value.anchor == null)) return value;
    const len = tr.changes.length;
    return {
      ...value,
      pos: value.pos == null ? null : tr.changes.mapPos(within(value.pos, len), 1),
      /* Mapped with the opposite bias to the head. An insertion AT the boundary of a
       * selection belongs outside it, not inside: the anchor holds its ground and the head
       * moves on, which is what the driver's own editor does. */
      anchor: value.anchor == null ? null : tr.changes.mapPos(within(value.anchor, len), -1),
    };
  },
  provide: f => EditorView.decorations.compute([f], state => {
    const { pos, name, anchor } = state.field(f);
    const len = state.doc.length;
    // A stale position past the end of a shorter document draws nothing rather than throwing.
    if (pos == null || pos > len) return Decoration.none;
    const marks = [];
    /* THE SHADE FIRST. Decoration.set wants its ranges in document order, and a mark that
     * starts where the widget sits would otherwise be sorted after it and throw. */
    if (anchor != null && anchor <= len && anchor !== pos) {
      marks.push(Decoration.mark({ class: 'cm-peer-range' })
        .range(Math.min(anchor, pos), Math.max(anchor, pos)));
    }
    marks.push(Decoration.widget({ widget: new Caret(name || 'Educator'), side: 1 }).range(pos));
    return Decoration.set(marks, true);
  }),
});

/* THE EXERCISE'S SETUP, ABOVE THE CODE AND NEVER PART OF IT.
 *
 * Students were starting exercises confused that `homelessness` already existed: the setup
 * that defines it runs before their code and was shown nowhere. So it is drawn at the top of
 * the editor, folded to one line by default, and opens on a click.
 *
 * A BLOCK WIDGET, NOT FOLDED TEXT, and that is the whole design. Put in the document, the
 * setup would be submitted by Check and run twice by Run, every error's line number would be
 * off by its length, and every caret offset that crosses the channel - remote control, a
 * shared screen - would point at the wrong character. Drawn above line 1, it is visible in
 * exactly the place a fold would be and absent from everything that reads the code.
 *
 * Highlighted by the editor's own style, so it reads as the same language as the code under
 * it, and dimmed, so it reads as not theirs to edit. A field rather than a plugin because
 * CodeMirror only accepts block decorations from state. */
const togglePreamble = StateEffect.define();

class Preamble extends WidgetType {
  constructor(code, language, open) {
    super();
    this.code = code; this.language = language; this.open = open;
  }
  eq(other) {
    return other.code === this.code && other.language === this.language && other.open === this.open;
  }
  toDOM(view) {
    const wrap = document.createElement('div');
    wrap.className = `cm-preamble${this.open ? ' open' : ''}`;
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'cm-preamble-head';
    head.setAttribute('aria-expanded', String(this.open));
    const lines = this.code.split('\n').length;
    const mark = document.createElement('span');
    mark.className = 'cm-preamble-mark';
    mark.textContent = '\u25B8';
    const what = document.createElement('span');
    what.textContent = 'Setup code';
    const count = document.createElement('span');
    count.className = 'cm-preamble-count';
    count.textContent = `${lines} line${lines === 1 ? '' : 's'}`;
    head.append(mark, what, count);
    // Kept off the editor's own selection: pressing it must not move anybody's caret.
    head.addEventListener('mousedown', e => e.preventDefault());
    head.addEventListener('click', () => view.dispatch({ effects: togglePreamble.of(null) }));
    wrap.append(head);
    if (this.open) {
      const pre = document.createElement('pre');
      pre.className = 'cm-preamble-code';
      const parser = (LANGUAGES[this.language] || LANGUAGES.sql)().language.parser;
      let at = 0;
      highlightTree(parser.parse(this.code), highlight, (from, to, classes) => {
        if (from > at) pre.append(this.code.slice(at, from));
        const span = document.createElement('span');
        span.className = classes;
        span.textContent = this.code.slice(from, to);
        pre.append(span);
        at = to;
      });
      if (at < this.code.length) pre.append(this.code.slice(at));
      wrap.append(pre);
    }
    return wrap;
  }
  // Its own clicks only: the editor must not read them as placing a caret in the code.
  ignoreEvent() { return true; }
}

const preamble = (code, language) => {
  const text = String(code || '').replace(/\s+$/, '');
  if (!text.trim()) return [];
  return StateField.define({
    create: () => false,
    update(open, tr) {
      for (const e of tr.effects) if (e.is(togglePreamble)) return !open;
      return open;
    },
    provide: f => EditorView.decorations.from(f, open => Decoration.set([
      Decoration.widget({ widget: new Preamble(text, language, open), block: true, side: -1 })
        .range(0),
    ])),
  });
};

const props = defineProps({
  modelValue: String,
  language: { type: String, default: 'sql' },
  /* Read-only, for a student whose screen somebody else is driving. TWO PEOPLE TYPING INTO
   * ONE BUFFER is not a thing this can do - there is no merge here and there should not be
   * one - so while an educator is driving, the student watches. The band says so. */
  readonly: Boolean,
  /** Where somebody else's caret is, and whose. Null draws nothing. */
  peerAt: { type: Number, default: null },
  /** The other end of their selection, when they have one. Null means a bare caret. */
  peerAnchor: { type: Number, default: null },
  peerName: String,
  /** Code that runs before this editor's, shown folded above it - see `Preamble`. */
  preamble: { type: String, default: '' },
  /** SQL only: the tables and columns this exercise can query, `{ table: [column] }`. */
  schema: { type: Object, default: null },
  /* A completion source of the caller's own, offered beside the language's: Python's names
   * from the live interpreter. Added as language data rather than as an override, so the
   * keywords and the names already typed stay offered too. */
  completions: { type: Function, default: null },
  /* What is wrong with the code: text -> [{ from, to, message, severity? }], or a promise of
   * it. The caller asks the engine that would run it - Python's compiler, Postgres's planner -
   * so a red line here means Run would fail. Null draws nothing. */
  lint: { type: Function, default: null },
  /** Bumped to check again without an edit: the engine that answers has just arrived. */
  lintAgain: { type: Number, default: 0 },
});
const emit = defineEmits(['update:modelValue', 'run', 'cursor']);
const host = ref(null);
let view = null;
/* A compartment rather than a rebuild: control starts and stops mid-lesson, and recreating
 * the view would throw away the undo history and the scroll position each time. */
const editable = new Compartment();
const preambled = new Compartment();
const language = new Compartment();
const completing = new Compartment();
const linting = new Compartment();
/* A SECOND AFTER THEY STOP TYPING, not on every key: a line half written is not wrong yet,
 * and a beginner shown red mid-word learns to distrust the red. Offsets are clamped, because
 * what comes back was computed against text that may since have changed length. */
const lintFor = () => (props.lint
  ? linter(async view => {
    const text = view.state.doc.toString();
    const found = (await props.lint(text)) || [];
    const len = view.state.doc.length;
    return found.map(d => {
      const from = Math.min(Math.max(0, d.from), len);
      return { from, to: Math.min(Math.max(from, d.to), len),
               severity: d.severity || 'error', message: d.message };
    });
  }, { delay: 1000 })
  : []);
const extraCompletions = () => (props.completions
  ? EditorState.languageData.of(() => [{ autocomplete: props.completions }])
  : []);
const languageFor = () => (LANGUAGES[props.language] || LANGUAGES.sql)(props.schema);

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue || '',
      extensions: [
        editable.of(EditorView.editable.of(!props.readonly)),
        preambled.of(preamble(props.preamble, props.language)),
        peer,
        lineNumbers(), history(), highlightActiveLine(),
        syntaxHighlighting(highlight, { fallback: true }),
        language.of(languageFor()),
        /* AS THEY TYPE, and Ctrl+Space when they want it sooner. Enter takes the suggestion
         * while the list is open and is a new line otherwise; Cmd/Ctrl+Enter still runs. */
        autocompletion(),
        completing.of(extraCompletions()),
        linting.of(lintFor()),
        keymap.of([
          { key: 'Mod-Enter', run: () => (emit('run'), true) },
          indentWithTab, ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.updateListener.of(u => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
          /* The caret travels separately from the text, and has to: a driver moving the
           * cursor without typing is still telling the other side where they are looking. */
          /* BOTH ENDS, ALWAYS TOGETHER. They describe one range, and sent apart the far end
           * would arrive against a head that had already moved - a highlight covering words
           * nobody selected. `anchor` equal to `head` is a plain caret and says so. */
          if (u.selectionSet || u.docChanged) {
            const r = u.state.selection.main;
            emit('cursor', { head: r.head, anchor: r.anchor });
          }
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
          /* THE SAME ORANGE THE CARET IS, at fill strength - `--ice-drive-fill` was already
             defined beside `--ice-drive-line` for exactly this and had no reader. One colour
             says "somebody else is driving this editor", and a highlight in a second hue
             would read as a second thing happening.

             Translucent rather than solid so the syntax colours under it survive: a
             selection that repainted the code would hide the thing being pointed at. */
          '.cm-peer-range': {
            background: 'var(--ice-drive-fill)',
            borderRadius: '2px',
            boxShadow: '0 0 0 1px var(--ice-drive-fill)',
          },
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
          /* Folded, one quiet line; open, the code under a rule. Dimmed either way, so it
             never reads as the student's own. */
          '.cm-preamble': {
            margin: '2px 0 6px', borderLeft: '2px solid var(--ice-border)',
            background: 'var(--ice-raise)', borderRadius: '0 6px 6px 0',
          },
          '.cm-preamble-head': {
            display: 'flex', alignItems: 'baseline', gap: '8px', width: '100%',
            padding: '3px 10px', background: 'none', border: '0', cursor: 'pointer',
            fontFamily: 'var(--ice-font-sans, inherit)', fontSize: '12px', lineHeight: '1.6',
            color: 'var(--ice-fg-muted)', textAlign: 'left',
          },
          '.cm-preamble-head:hover': { color: 'var(--ice-fg)' },
          '.cm-preamble-mark': { display: 'inline-block', transition: 'transform .12s' },
          '.cm-preamble.open .cm-preamble-mark': { transform: 'rotate(90deg)' },
          '.cm-preamble-count': { opacity: '.75' },
          '.cm-preamble-code': {
            margin: '0', padding: '0 10px 6px 26px', whiteSpace: 'pre', overflowX: 'auto',
            fontFamily: 'var(--ice-font-mono)', fontSize: '13px', lineHeight: '1.6',
            opacity: '.8',
          },
          /* The suggestion list, in the app's own tokens: CodeMirror's default is a light
             box, which in the dark theme is a white rectangle over the code. */
          '.cm-tooltip': {
            background: 'var(--ice-bg)', color: 'var(--ice-fg)',
            border: '1px solid var(--ice-border)', borderRadius: '8px',
            boxShadow: '0 8px 24px rgb(0 0 0 / .22)', overflow: 'hidden',
          },
          '.cm-tooltip.cm-tooltip-autocomplete > ul': {
            fontFamily: 'var(--ice-font-mono)', fontSize: '13px', maxHeight: '14em',
          },
          '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '2px 10px 2px 6px' },
          '.cm-tooltip-autocomplete ul li[aria-selected]': {
            background: 'var(--ice-primary-soft)', color: 'var(--ice-fg)',
          },
          '.cm-completionDetail': { color: 'var(--ice-fg-muted)', fontStyle: 'normal' },
          '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
          /* The app's own red and amber rather than CodeMirror's, which are drawn into an
             SVG and cannot follow the theme. A wavy underline is still what everyone reads
             as "this is wrong". */
          '.cm-lintRange-error, .cm-lintRange-warning': {
            backgroundImage: 'none', textDecorationLine: 'underline',
            textDecorationStyle: 'wavy', textDecorationSkipInk: 'none',
            textUnderlineOffset: '3px',
          },
          '.cm-lintRange-error': { textDecorationColor: 'var(--ice-bad)' },
          '.cm-lintRange-warning': { textDecorationColor: 'var(--ice-warn)' },
          '.cm-diagnostic': {
            padding: '6px 10px', fontFamily: 'var(--ice-font-sans, inherit)', fontSize: '12.5px',
          },
          '.cm-diagnostic-error': { borderLeft: '3px solid var(--ice-bad)' },
          '.cm-diagnostic-warning': { borderLeft: '3px solid var(--ice-warn)' },
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
    anchor: props.peerAnchor == null ? null : Number(props.peerAnchor),
    name: props.peerName,
  }),
});
watch(() => [props.peerAt, props.peerAnchor, props.peerName], applyPeer);

watch(() => props.lint, () => {
  view?.dispatch({ effects: linting.reconfigure(lintFor()) });
});
watch(() => props.lintAgain, () => { if (view && props.lint) forceLinting(view); });

watch(() => props.completions, () => {
  view?.dispatch({ effects: completing.reconfigure(extraCompletions()) });
});

watch(() => [props.language, props.schema], () => {
  view?.dispatch({ effects: language.reconfigure(languageFor()) });
});

watch(() => [props.preamble, props.language], () => {
  view?.dispatch({ effects: preambled.reconfigure(preamble(props.preamble, props.language)) });
});

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

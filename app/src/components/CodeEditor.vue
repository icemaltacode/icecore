<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
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

const props = defineProps({ modelValue: String, language: { type: String, default: 'sql' } });
const emit = defineEmits(['update:modelValue', 'run']);
const host = ref(null);
let view = null;

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue || '',
      extensions: [
        lineNumbers(), history(), highlightActiveLine(),
        syntaxHighlighting(highlight, { fallback: true }),
        (LANGUAGES[props.language] || LANGUAGES.sql)(),
        keymap.of([
          { key: 'Mod-Enter', run: () => (emit('run'), true) },
          indentWithTab, ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.updateListener.of(u => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
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
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ice-fg)' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
            background: 'var(--ice-primary-soft)',
          },
        }),
      ],
    }),
  });
});

// external changes (moving to another step) replace the whole document
watch(() => props.modelValue, v => {
  if (view && v !== view.state.doc.toString())
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v || '' } });
});

onBeforeUnmount(() => view?.destroy());
</script>

<template><div ref="host" class="editor"></div></template>

<style scoped>
.editor { height: 100%; overflow: auto; background: var(--ice-code-bg); }
</style>

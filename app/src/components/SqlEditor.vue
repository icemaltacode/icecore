<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';

const props = defineProps({ modelValue: String });
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
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        sql({ dialect: PostgreSQL }),
        keymap.of([
          { key: 'Mod-Enter', run: () => (emit('run'), true) },
          indentWithTab, ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.updateListener.of(u => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
        }),
        EditorView.theme({
          '&': { fontSize: '14px', height: '100%' },
          '.cm-scroller': { fontFamily: 'var(--ice-font-mono)', lineHeight: '1.6' },
          '&.cm-focused': { outline: 'none' },
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

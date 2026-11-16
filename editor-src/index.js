// Части CodeMirror 6, которые нужны Calque. Сборка: npm run build → cm.js
export { EditorState, EditorSelection, StateField, StateEffect, RangeSetBuilder, Transaction } from '@codemirror/state';
export { EditorView, Decoration, WidgetType, keymap, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view';
export { history, defaultKeymap, historyKeymap, indentMore, indentLess, insertNewlineAndIndent, undo, redo } from '@codemirror/commands';
export { indentUnit, indentService, foldService, foldGutter, foldKeymap, codeFolding, foldEffect, unfoldEffect, foldedRanges, StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
export { autocompletion, completionKeymap, acceptCompletion, startCompletion } from '@codemirror/autocomplete';
export { tags } from '@lezer/highlight';

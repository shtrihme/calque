// Части CodeMirror 6, которые нужны Calque. Сборка: npm run build → cm.js
export { EditorState, EditorSelection, StateField, StateEffect, RangeSetBuilder, Transaction, Compartment, Annotation } from '@codemirror/state';
export { EditorView, Decoration, WidgetType, keymap, drawSelection, highlightActiveLine, placeholder, hoverTooltip, showTooltip, rectangularSelection, crosshairCursor, lineNumbers } from '@codemirror/view';
export { history, defaultKeymap, historyKeymap, indentMore, indentLess, insertNewlineAndIndent, undo, redo } from '@codemirror/commands';
export { indentUnit, indentService, foldService, foldGutter, foldKeymap, codeFolding, foldEffect, unfoldEffect, foldedRanges, StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
export { autocompletion, completionKeymap, acceptCompletion, startCompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
export { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
export { linter, forceLinting } from '@codemirror/lint';
export { tags } from '@lezer/highlight';

// ###################
// attachHighlighter: a live CodeMirror 6 editor for ArcMoon
// Needs @codemirror/view, @codemirror/state, @codemirror/commands and @codemirror/lint
// ###################

import { EditorView, ViewPlugin, Decoration, keymap, lineNumbers } from "@codemirror/view";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { history, defaultKeymap, historyKeymap, indentWithTab, deleteCharBackward } from "@codemirror/commands";
import { linter, lintGutter } from "@codemirror/lint";
import tokenize from "./tokens.js";
import { diagnose } from "./diagnostics.js";
import defaults from "./defaults.js";
import { styleOf } from "./highlight.js";

const markOf = (style) => Decoration.mark({ attributes: { style } });

// ###################
// A render / context result is HTML: each <span style> in it becomes one mark
// ###################
const SPAN = /<span\b[^>]*\bstyle="([^"]*)"[^>]*>([^<]*)<\/span>/g;
const textLength = (html) => html.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").length;

const marksFromHtml = (html, from, to, mark) => {
	let offset = 0;
	let last = 0;
	let found = false;
	for (const m of html.matchAll(SPAN)) {
		found = true;
		offset += textLength(html.slice(last, m.index));
		last = m.index + m[0].length;
		const length = textLength(m[2]);
		if (m[1] && length) mark(from + offset, from + offset + length, m[1]);
		offset += length;
	}
	if (!found) {
		const style = /\bstyle="([^"]*)"/.exec(html)?.[1];
		if (style) mark(from, to, style);
	}
};

// ###################
// The same order as staticHighlight: onToken → tokens[type] → other → defaults
// true when this config drew the token
// ###################
const drawWith = (config, ctx, mark) => {
	const { current } = ctx;
	if (config === null) return true;
	if (typeof config === "string") return mark(current.from, current.to, `color:${config}`), true;
	if (typeof config.decorate === "function") return config.decorate(current.value, current.from, mark), true;
	if (typeof config.render === "function") return marksFromHtml(config.render(current.value, current.type), current.from, current.to, mark), true;
	if (typeof config.context === "function") {
		const html = config.context(ctx);
		if (html !== undefined && html !== null) return marksFromHtml(html, current.from, current.to, mark), true;
	}
	const style = styleOf(config);
	if (style) return mark(current.from, current.to, style), true;
	return false;
};

const buildMarks = (view, config) => {
	const { tokens: userTokens, other, onToken } = config;
	const tokens = tokenize(view.state.doc.toString());
	const builder = new RangeSetBuilder();
	let end = 0;
	// ###################
	// RangeSetBuilder needs marks in order and not overlapping
	// ###################
	const mark = (from, to, style) => {
		if (from < end || to <= from) return;
		builder.add(from, to, markOf(style));
		end = to;
	};
	tokens.forEach((current, i) => {
		if (current.type === "WHITESPACE") return;
		const ctx = { prev: tokens[i - 1] ?? null, current, next: tokens[i + 1] ?? null };
		if (onToken) {
			const html = onToken(ctx);
			if (html !== undefined && html !== null) return marksFromHtml(html, current.from, current.to, mark);
		}
		if (userTokens?.[current.type] !== undefined && drawWith(userTokens[current.type], ctx, mark)) return;
		if (other !== undefined && drawWith(other, ctx, mark)) return;
		if (defaults[current.type] !== undefined) drawWith(defaults[current.type], ctx, mark);
	});
	return builder.finish();
};

// ###################
// Errors: every one gets an underline, a gutter mark and a tooltip
// ArcMoon's own errors are red, JavaScript errors orange
// ###################
const wave = (color) =>
	`url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><path d="m0 2.5 l2 -1.5 l1 0 l2 1.5 l1 0" stroke="${encodeURIComponent(color)}" fill="none" stroke-width=".7"/></svg>')`;

// ###################
// show: false still checks and calls onDiagnostics / onError, but draws nothing
// ###################
const errorsOf = ({ rules, show, onError, onDiagnostics }) =>
	linter(
		(view) => {
			const list = diagnose(view.state.doc.toString(), { rules });
			onDiagnostics?.(list);
			onError?.(list.length ? `${list[0].source}: ${list[0].message}` : null);
			if (!show) return [];
			return list.map(({ from, to, severity, source, message }) => ({ from, to, severity, source, message, markClass: source === "JavaScript" ? "cm-am-js" : "cm-am-arcmoon" }));
		},
		{ delay: 250 }
	);

const pluginOf = (build) =>
	ViewPlugin.fromClass(
		class {
			constructor(view) {
				this.decorations = build(view);
			}
			update(update) {
				if (update.docChanged) this.decorations = build(update.view);
			}
		},
		{ decorations: (v) => v.decorations }
	);

// ###################
// Backspace in the indent goes back to the previous tab stop
// ###################
const smartBackspace = ({ state, dispatch }) => {
	const range = state.selection.main;
	if (!range.empty) return deleteCharBackward({ state, dispatch });
	const line = state.doc.lineAt(range.head);
	const col = range.head - line.from;
	const before = line.text.slice(0, col);
	if (/\S/.test(before) || !before.length) return deleteCharBackward({ state, dispatch });
	const size = state.tabSize ?? 4;
	const back = before.endsWith("\t") ? 1 : (col - 1) % size || size;
	const from = Math.max(line.from, range.head - back);
	dispatch(state.update({ changes: { from, to: range.head }, scrollIntoView: true, userEvent: "delete.backward" }));
	return true;
};

export function attachHighlighter(element, config = {}) {
	const { caretColor = "#e8eaf0", showLineNumbers = true, showErrors = true, rules = true, onError, onDiagnostics, ...colors } = config;
	let onUpdate = null;

	const theme = EditorView.theme({
		"&": { height: "100%", background: "transparent" },
		".cm-scroller": { fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit", overflow: "auto" },
		".cm-content": { padding: "1rem 0", caretColor },
		".cm-line": { padding: "0 1.25rem" },
		".cm-cursor, .cm-dropCursor": { borderLeftColor: caretColor },
		".cm-selectionBackground, .cm-content ::selection": { background: "rgba(99,102,241,0.3) !important" },
		"&.cm-focused": { outline: "none" },
		".cm-gutters": { background: "transparent", border: "none", borderRight: "1px solid rgba(255,255,255,0.07)", color: "#4b4f68" },
		".cm-gutterElement": { padding: "0 0.75rem 0 0.5rem", textAlign: "right" },
		".cm-activeLineGutter": { background: "transparent", color: "#8b8fa8" },
		".cm-activeLine": { background: "rgba(99,102,241,0.04)" },
		".cm-lintRange-error.cm-am-arcmoon": { backgroundImage: wave("#f43f5e") },
		".cm-lintRange-error.cm-am-js": { backgroundImage: wave("#f59e0b") },
		".cm-tooltip": { background: "#1e1e24", color: "#e8eaf0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px" },
		".cm-diagnostic": { padding: "4px 8px", fontFamily: "inherit" },
		".cm-diagnosticSource": { color: "#8b8fa8", opacity: 1 },
		".cm-diagnostic-error": { borderLeft: "3px solid #f43f5e" },
		".cm-gutter-lint": { width: "0.9em" },
		".cm-gutter-lint .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center", padding: "0" },
		".cm-lint-marker": { width: "0.5em", height: "0.5em" },
		".cm-lint-marker-error": { content: "none", background: "#f43f5e", borderRadius: "50%" }
	});

	const extensions = [
		history(),
		keymap.of([indentWithTab, { key: "Backspace", run: smartBackspace }, ...defaultKeymap, ...historyKeymap]),
		pluginOf((view) => buildMarks(view, colors)),
		theme,
		EditorView.lineWrapping,
		EditorView.updateListener.of((update) => {
			if (update.docChanged && onUpdate) onUpdate(update.view.state.doc.toString());
		})
	];
	if (showLineNumbers) extensions.push(lineNumbers());
	if (showErrors || onError || onDiagnostics) extensions.push(errorsOf({ rules, show: showErrors, onError, onDiagnostics }));
	if (showErrors) extensions.push(lintGutter());

	const view = new EditorView({ state: EditorState.create({ doc: "", extensions }), parent: element });

	return {
		view,
		getValue: () => view.state.doc.toString(),
		setValue: (code) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } }),
		onUpdate: (fn) => {
			onUpdate = fn;
		},
		// ###################
		// Select an error (or any { from, to }), scroll to it and focus the editor
		// ###################
		goTo: ({ from, to = from }) => {
			const end = view.state.doc.length;
			view.dispatch({ selection: { anchor: Math.min(from, end), head: Math.min(to, end) }, scrollIntoView: true });
			view.focus();
		},
		destroy: () => view.destroy()
	};
}

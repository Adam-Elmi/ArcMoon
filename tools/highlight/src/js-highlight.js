// ###################
// JavaScript inside ${ }$ and runtime ${ }$, with js-tokens
// ###################

import jsTokens from "js-tokens";

const KEYWORDS = new Set([
	"break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else",
	"export", "extends", "finally", "for", "function", "if", "import", "from", "in", "instanceof", "let", "new",
	"of", "return", "static", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while",
	"with", "yield", "async", "await", "true", "false", "null", "undefined"
]);

export const JS_COLORS = {
	keyword: "color:#c586c0",
	call: "color:#dcdcaa",
	key: "color:#9cdcfe",
	property: "color:#9cdcfe",
	string: "color:#ce9178",
	number: "color:#b5cea8",
	comment: "color:#6a9955;font-style:italic",
	regex: "color:#d16969",
	operator: "color:#d4d4d4",
	name: "color:#9cdcfe"
};

const SPACE = new Set(["WhiteSpace", "LineTerminatorSequence"]);
const near = (tokens, i, step) => {
	for (let j = i + step; j >= 0 && j < tokens.length; j += step) if (!SPACE.has(tokens[j].type)) return tokens[j];
	return null;
};

// ###################
// The kind of one JS token: keyword, call, key, property, string…
// ###################
export function jsKind(tokens, i) {
	const t = tokens[i];
	const next = near(tokens, i, 1);
	const prev = near(tokens, i, -1);
	switch (t.type) {
		case "IdentifierName":
			if (KEYWORDS.has(t.value) && prev?.value !== ".") return "keyword";
			if (next?.value === "(") return "call";
			if (next?.value === ":" && prev?.value !== "?" && prev?.value !== "case") return "key";
			if (prev?.value === ".") return "property";
			return "name";
		case "StringLiteral":
			return next?.value === ":" && prev?.value !== "?" ? "key" : "string";
		case "NoSubstitutionTemplate":
		case "TemplateHead":
		case "TemplateMiddle":
		case "TemplateTail":
			return "string";
		case "NumericLiteral":
			return "number";
		case "RegularExpressionLiteral":
			return "regex";
		case "SingleLineComment":
		case "MultiLineComment":
			return "comment";
		case "Punctuator":
			return "operator";
		default:
			return null;
	}
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ###################
// classPrefix: "am-" gives class="am-js-keyword" instead of inline styles
// ###################
export function highlightJs(code, { classPrefix } = {}) {
	const tokens = [...jsTokens(code)];
	let out = "";
	for (let i = 0; i < tokens.length; i++) {
		const kind = jsKind(tokens, i);
		const text = escapeHtml(tokens[i].value);
		if (!kind) out += text;
		else if (classPrefix) out += `<span class="${classPrefix}js-${kind}">${text}</span>`;
		else out += `<span style="${JS_COLORS[kind]}">${text}</span>`;
	}
	return out;
}

// ###################
// For the live editor: marks ranges, no HTML
// mark(from, to, style)
// ###################
export function decorateJs(code, pos, mark) {
	const tokens = [...jsTokens(code)];
	let offset = 0;
	for (let i = 0; i < tokens.length; i++) {
		const kind = jsKind(tokens, i);
		const len = tokens[i].value.length;
		if (kind) mark(pos + offset, pos + offset + len, JS_COLORS[kind]);
		offset += len;
	}
}

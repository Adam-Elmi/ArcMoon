// ###################
// Default colors: a dark theme (VS Code Dark+ colors)
// ###################

import { highlightJs, decorateJs } from "./js-highlight.js";

const PUNCT = { color: "#8b8fa8" };
const BRACKET = { color: "#c586c0" };
const KEYWORD = { color: "#c586c0" };
const LOGIC_EDGE = { color: "#569cd6" };
const COMMENT = { color: "#6a9955", italic: true };

const defaults = {
	OPEN_BRACKET: BRACKET,
	CLOSE_BRACKET: BRACKET,
	EQUAL: PUNCT,
	COLON: PUNCT,
	COMMA: PUNCT,
	EXCLAMATION_MARK: { color: "#f87171" },
	ESCAPE: { color: "#fb923c" },

	END_KEYWORD: { color: "#c586c0", bold: true },
	IMPORT: KEYWORD,
	SLOT: KEYWORD,
	FOR_EACH: KEYWORD,
	RUNTIME_KEYWORD: KEYWORD,

	IDENTIFIER: { color: "#4ec9b0" },
	KEY: { color: "#7dd3fc" },
	STRING: { color: "#ce9178" },
	NUMBER: { color: "#b5cea8" },
	BOOLEAN: { color: "#569cd6" },
	WORD: { color: "#fbbf24" },

	LOGIC_OPEN: LOGIC_EDGE,
	// ###################
	// render: static HTML; decorate: the live editor (no HTML in between)
	// ###################
	LOGIC: { render: (value) => highlightJs(value), decorate: decorateJs },
	LOGIC_CLOSE: LOGIC_EDGE,

	COMMENT,
	COMMENT_BLOCK: COMMENT,

	TEXT: { color: "#e8eaf0" },
	WHITESPACE: null,

	// ###################
	// CSS in [style]
	// ###################
	CSS_SELECTOR: { color: "#d7ba7d" },
	CSS_CLASS: { color: "#d7ba7d" },
	CSS_ID: { color: "#d7ba7d" },
	CSS_PSEUDO: { color: "#d7ba7d" },
	CSS_ATTRIBUTE: { color: "#9cdcfe" },
	CSS_AT_RULE: KEYWORD,
	CSS_PROPERTY: { color: "#9cdcfe" },
	CSS_VARIABLE: { color: "#9cdcfe" },
	CSS_VALUE: { color: "#ce9178" },
	CSS_NUMBER: { color: "#b5cea8" },
	CSS_COLOR: { color: "#ce9178" },
	CSS_FUNCTION: { color: "#dcdcaa" },
	CSS_STRING: { color: "#ce9178" },
	CSS_IMPORTANT: { color: "#569cd6", bold: true },
	CSS_COMMENT: COMMENT,
	CSS_PUNCTUATION: PUNCT,
	CSS_TEXT: { color: "#e8eaf0" }
};

export default defaults;

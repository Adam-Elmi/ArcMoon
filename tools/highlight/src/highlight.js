// ###################
// staticHighlight: ArcMoon source → HTML string
// Each token is drawn by the first that answers:
//   onToken → tokens[type] → other → defaults → plain text
// errors (off by default): a list like diagnose() gives, drawn as wavy underlines
// ###################

import tokenize from "./tokens.js";
import defaults from "./defaults.js";
import { highlightJs } from "./js-highlight.js";

export const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ###################
// { color, bold, italic } → "color:…;font-weight:bold"
// ###################
export const styleOf = (config) => {
	const parts = [];
	if (config.color) parts.push(`color:${config.color}`);
	if (config.bold) parts.push("font-weight:bold");
	if (config.italic) parts.push("font-style:italic");
	return parts.join(";");
};

// ###################
// One config entry: a color string, { color, bold, italic }, { render }, { context } or null
// undefined means "no answer, ask the next one"
// ###################
const fromConfig = (config, ctx) => {
	const { current } = ctx;
	if (config === null) return escapeHtml(current.value);
	if (typeof config === "string") return `<span style="color:${config}">${escapeHtml(current.value)}</span>`;
	if (typeof config.render === "function") return config.render(current.value, current.type);
	if (typeof config.context === "function") {
		const out = config.context(ctx);
		if (out !== undefined && out !== null) return out;
	}
	const style = styleOf(config);
	if (style) return `<span style="${style}">${escapeHtml(current.value)}</span>`;
	return undefined;
};

const kebab = (type) => type.toLowerCase().replace(/_/g, "-");

// ###################
// Tokens cut where an error starts or ends, so underlines can start inside a token
// ###################
const cutAt = (tokens, errors) => {
	const edges = [...new Set(errors.flatMap((e) => [e.from, e.to]))].sort((a, b) => a - b);
	return tokens.flatMap((t) => {
		const inside = edges.filter((e) => e > t.from && e < t.to);
		if (!inside.length) return [t];
		return [t.from, ...inside].map((from, i, list) => {
			const to = list[i + 1] ?? t.to;
			return { ...t, value: t.value.slice(from - t.from, to - t.from), from, to };
		});
	});
};

const ERROR_COLORS = { ArcMoon: "#f43f5e", JavaScript: "#f59e0b" };

const errorOpen = (error, classPrefix) => {
	const title = escapeHtml(`${error.source ? `${error.source}: ` : ""}${error.message ?? ""}`).replace(/"/g, "&quot;");
	if (classPrefix) {
		const kind = error.source ? ` ${classPrefix}error-${error.source.toLowerCase()}` : "";
		return `<span class="${classPrefix}error${kind}" title="${title}">`;
	}
	const color = ERROR_COLORS[error.source] ?? ERROR_COLORS.ArcMoon;
	return `<span style="text-decoration:underline wavy ${color};text-decoration-skip-ink:none;text-underline-offset:3px" title="${title}">`;
};

export function staticHighlight(src, config = {}) {
	const { tokens: userTokens, other, onToken, classPrefix, errors = [] } = config;
	const marks = errors.filter((e) => e.to > e.from);
	const tokens = marks.length ? cutAt(tokenize(src), marks) : tokenize(src);
	const pieces = tokens
		.map((current, i) => {
			if (current.type === "WHITESPACE") return current.value;
			const ctx = { prev: tokens[i - 1] ?? null, current, next: tokens[i + 1] ?? null };
			if (onToken) {
				const out = onToken(ctx);
				if (out !== undefined && out !== null) return out;
			}
			if (userTokens?.[current.type] !== undefined) {
				const out = fromConfig(userTokens[current.type], ctx);
				if (out !== undefined) return out;
			}
			if (other !== undefined) {
				const out = fromConfig(other, ctx);
				if (out !== undefined) return out;
			}
			// ###################
			// classPrefix: class names instead of the default colors, for themes in CSS
			// ###################
			if (classPrefix) {
				const body = current.type === "LOGIC" ? highlightJs(current.value, { classPrefix }) : escapeHtml(current.value);
				return `<span class="${classPrefix}${kebab(current.type)}">${body}</span>`;
			}
			if (defaults[current.type] !== undefined) {
				const out = fromConfig(defaults[current.type], ctx);
				if (out !== undefined) return out;
			}
			return escapeHtml(current.value);
		});
	if (!marks.length) return pieces.join("");

	// ###################
	// Pieces inside one error share one underline
	// ###################
	let out = "";
	let open = null;
	tokens.forEach((t, i) => {
		const error = marks.find((e) => e.from <= t.from && t.to <= e.to) ?? null;
		if (error !== open) {
			if (open) out += "</span>";
			if (error) out += errorOpen(error, classPrefix);
			open = error;
		}
		out += pieces[i];
	});
	return open ? out + "</span>" : out;
}

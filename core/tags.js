// ###################
// Warn about blocks that are not HTML, SVG, MathML or components,
// about positional values on elements (only components use them), and css.name typos.
// 1.1: content in void elements (B27), unknown arcm- props (B28), props on [slot] and [slot]
// in a page (B33, B40), [doctype!] after content (B38), unknown props on [for-each] (B39)
// ###################

import { htmlTagNames } from "html-tag-names";
import { svgTagNames } from "svg-tag-names";
import { mathmlTagNames } from "mathml-tag-names";
import { all as cssProperties } from "known-css-properties";
import { NODE_TYPES as N } from "./parser.js";
import closest from "./suggest.js";

const HTML = new Set(htmlTagNames);
const SVG = new Set(svgTagNames);
const SVG_LOWER = new Set(svgTagNames.map((t) => t.toLowerCase()));
const MATHML = new Set(mathmlTagNames);
const CSS = new Set(cssProperties);
const CSS_LIST = cssProperties.filter((p) => !p.startsWith("-"));
const KNOWN = [...new Set([...htmlTagNames, ...svgTagNames, ...mathmlTagNames])];
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const DIRECTIVES = ["raw", "ref", "shared-ref", "syntax"];

// ###################
// [A] written as <a> (B30): a capitalized name that is an HTML tag when case is ignored
// ###################
export const htmlTagName = (id) => (/^[A-Z]/.test(id) && HTML.has(id.toLowerCase()) ? id.toLowerCase() : id);

const empty = (body) => !body?.some((n) => n.type !== N.TEXT || n.text.trim());

const isKnown = (id) => {
	const lower = id.toLowerCase();
	return HTML.has(lower) || SVG.has(id) || SVG_LOWER.has(lower) || MATHML.has(lower) || lower === "doctype" || id.includes("-");
};

// ###################
// Returns warnings; runs no code
// ###################
export default function unknownTags(graph) {
	const warnings = [];
	for (const mod of graph.modules.values()) {
		const components = [...mod.imports.keys()];
		const isPage = mod.id === graph.entry;
		const warn = (node, message) => warnings.push({ source: mod.id, position: node.range.start, message });

		const visit = (nodes, inside = false) => {
			for (const node of nodes) {
				if (node.type === N.BLOCK && node.id.toLowerCase() === "doctype" && inside) {
					warn(node, "[doctype!] inside another block is written there; it must be first, at the top of the page");
				}
				if (node.type === N.BLOCK && VOID.has(node.id.toLowerCase()) && !empty(node.body)) {
					warn(node, `[${node.id}] can't have content (<${node.id.toLowerCase()}> is a void element); write [${node.id} = … !]`);
				}
				// ###################
				// arcm-rwa: not a directive; directives never reach the HTML, so it would vanish silently
				// ###################
				for (const key of Object.keys(node.directives ?? {})) {
					if (DIRECTIVES.includes(key)) continue;
					const hint = closest(key, DIRECTIVES);
					warn(node, `arcm-${key} is not an ArcMoon directive, so it does nothing${hint ? ` (did you mean arcm-${hint}?)` : ""}; directives are arcm-raw, arcm-ref, arcm-shared-ref and arcm-syntax`);
				}
				if (node.type === N.SLOT) {
					const keys = Object.keys(node.props ?? {});
					if (keys.length) warn(node, `[slot] takes no props (${keys.join(", ")}); there is one slot per component, pass other areas as props`);
					if (isPage) warn(node, "[slot] in a page shows nothing but its fallback: a page has no caller. Use [slot] in components");
				}
				if (node.type === N.FOR_EACH) {
					const live = node.source?.type === N.RUNTIME_LOGIC;
					const allowed = live ? ["0", "as", "key"] : ["0", "as"];
					for (const key of Object.keys(node.props ?? {})) {
						if (allowed.includes(key)) continue;
						const hint = key === "key" ? null : closest(key, allowed.slice(1));
						warn(node, key === "key"
							? "key: only works on a live [for-each] (its list in runtime ${ }$); here it does nothing"
							: `${/^\d+$/.test(key) ? "a second list" : `${key}:`} on [for-each] does nothing${hint ? ` (did you mean ${hint}:?)` : ""}`);
					}
				}
				// ###################
				// [A] without an import: only HTML when case is ignored, likely a missing import
				// ###################
				if (node.type === N.BLOCK && /^[A-Z]/.test(node.id) && isKnown(node.id) && node.id.toLowerCase() !== "doctype") {
					warnings.push({
						source: mod.id,
						position: node.range.start,
						message: `[${node.id}] is not imported; it is written as <${node.id.toLowerCase()}>. Did you forget [import = ${node.id}: "./${node.id}.arcm" !]?`
					});
				} else if (node.type === N.BLOCK && !isKnown(node.id)) {
					const hint = closest(node.id, components) ?? closest(node.id.toLowerCase(), KNOWN);
					warnings.push({
						source: mod.id,
						position: node.range.start,
						message: `[${node.id}] is not an HTML element or an imported component${hint ? ` (did you mean [${hint}]?)` : ""}`
					});
				}
				if (node.type === N.BLOCK && !mod.imports.has(node.id)) {
					const positional = Object.keys(node.props ?? {}).filter((k) => /^\d+$/.test(k)).map((k) => node.props[k]);
					if (positional.length) {
						const shown = positional.map((v) => (typeof v === "object" && v !== null ? (v.type === N.RUNTIME_LOGIC ? "runtime ${ … }$" : "${ … }$") : JSON.stringify(v))).join(", ");
						warnings.push({
							source: mod.id,
							position: node.range.start,
							message: `positional value${positional.length > 1 ? "s" : ""} ${shown} on [${node.id}] ${positional.length > 1 ? "are" : "is"} not used; HTML elements only take named props (key: value)`
						});
					}
				}
				// ###################
				// css.colr: not a CSS property; it is still written
				// ###################
				if (node.type === N.BLOCK) {
					for (const key of Object.keys(node.props ?? {})) {
						const name = key.startsWith("css.") ? key.slice(4) : null;
						// ###################
						// A name that can't be a CSS property (css., css.1x) gets the build error instead
						// ###################
						if (!name || !/^-{0,2}[A-Za-z][A-Za-z0-9-]*$/.test(name) || name.startsWith("--") || /^-[a-z]+-/i.test(name) || CSS.has(name.toLowerCase())) continue;
						const hint = closest(name.toLowerCase(), CSS_LIST);
						warnings.push({
							source: mod.id,
							position: node.range.start,
							message: `${key} on [${node.id}] is not a CSS property${hint ? ` (did you mean css.${hint}?)` : ""}`
						});
					}
				}
				if (node.body) visit(node.body, true);
			}
		};
		visit(mod.ast);

		// ###################
		// [doctype!] goes first, at the top of the page (B38)
		// ###################
		if (isPage) {
			const top = mod.ast.findIndex((n) => n.type === N.BLOCK && n.id.toLowerCase() === "doctype");
			const before = top > 0 ? mod.ast.slice(0, top).find((n) => n.type === N.BLOCK || n.type === N.FOR_EACH || n.type === N.SLOT || mod.imports.has(n.id) || (n.type === N.TEXT && n.text.trim())) : null;
			if (before) warn(mod.ast[top], `[doctype!] comes after other content (line ${before.range.start.line + 1}); it must be first, or browsers draw the page in quirks mode`);
		}

	}
	return warnings;
}

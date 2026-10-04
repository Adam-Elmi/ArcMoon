// ###################
// Warn about blocks that are not HTML, SVG, MathML or components,
// about positional values on elements (only components use them), and css.name typos
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
		const visit = (nodes) => {
			for (const node of nodes) {
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
				if (node.body) visit(node.body);
			}
		};
		visit(mod.ast);
	}
	return warnings;
}

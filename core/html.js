// ###################
// Page tree to HTML: attribute names, doctype, the runtime script
// ###################

import { find, html, svg } from "property-information";

export class CompilerError extends Error {
	constructor(message, source, position) {
		const where = position ? `${source}:${position.line + 1}:${position.character + 1}` : source;
		super(`${where}  ${message}`);
		this.name = "CompilerError";
		this.source = source;
		this.position = position;
	}
}

// ###################
// An attribute name can't be empty or hold spaces, quotes, ">", "/", "=" or control characters
// ###################
export const badAttribute = (key, tagName, data = {}) => {
	if (key && !/[\s"'>/=\x00-\x1f\x7f]/.test(key)) return null;
	const what = key ? `can't contain spaces, quotes, ">", "/", "=" or control characters` : "can't be empty";
	return new CompilerError(`${JSON.stringify(key)} on [${tagName}] is not a valid attribute name: it ${what}`, data.source ?? "", data.position);
};

const isRuntime = (v) => v !== null && typeof v === "object" && v.type === "runtime";

const notYet = (node) => {
	throw new CompilerError("runtime ${ }$ was not prepared before building HTML", node.source, node.range?.start);
};

// ###################
// Keys hast would rename (dataX -> data-x, "data:x" -> data-:x) are kept out of hast: the element
// gets a marker, and the keys are written as typed after HTML (writeExact) or DOM (setExact)
// ###################
const CSS_NAME = /^-{0,2}[A-Za-z][A-Za-z0-9-]*$/;
const EXACT = "data-arcm-exact";
const nonce = Math.random().toString(36).slice(2, 10);
let nextExact = 0;

const sameName = (info, key, schema) => (schema.space === "svg" ? info.attribute === key : info.attribute.toLowerCase() === key.toLowerCase());

// ###################
// .arcm prop names to hast property names
// ###################
const toProperties = (props, schema, tagName, data = {}, exact = []) => {
	const properties = {};
	// ###################
	// style:, css.name and --name join one style attribute, in the order written
	// ###################
	const styles = [];
	let extra = false;
	for (const [key, value] of Object.entries(props)) {
		if (/^\d+$/.test(key)) continue;
		const bad = badAttribute(key, tagName, data);
		if (bad) throw bad;
		const css = key.startsWith("css.");
		if (css || key.startsWith("--")) {
			const name = css ? key.slice(4) : key;
			if (css && !CSS_NAME.test(name)) {
				throw new CompilerError(`${key} on [${tagName}] is not a valid CSS property name; write css.name, like css.font-size`, data.source ?? "", data.position);
			}
			if (isRuntime(value)) notYet(value);
			if (value === null || value === undefined || value === false) continue;
			// ###################
			// css.name: "" (not filled in yet) writes nothing, not "name: ;"
			// ###################
			if (css && String(value).trim() === "") continue;
			// ###################
			// ; { } would end the declaration and add other CSS to the style attribute
			// ###################
			if (/[;{}]/.test(String(value))) {
				throw new CompilerError(`${key} on [${tagName}] can't contain ";", "{" or "}": it would add other CSS to the element. Got ${JSON.stringify(String(value))}`, data.source ?? "", data.position);
			}
			styles.push(`${name}: ${value}`);
			extra = true;
			continue;
		}
		if (value === null || value === undefined || value === false) continue;
		if (isRuntime(value)) notYet(value);
		if (typeof value === "object") {
			throw new CompilerError(`prop "${key}" on [${tagName}] is an object; attributes must be text, numbers or booleans`, "");
		}
		if (key === "style" && typeof value === "string") styles.push(value.trim().replace(/;$/, ""));

		const info = find(schema, key);
		if (!sameName(info, key, schema)) {
			exact.push([key, value === true ? true : String(value)]);
			continue;
		}
		let v = value;
		if (typeof v === "string" && info.spaceSeparated) v = v.split(/\s+/).filter(Boolean);
		else if (typeof v === "string" && info.commaSeparated) v = v.split(",").map((x) => x.trim()).filter(Boolean);
		properties[info.property] = v;
	}

	if (extra) properties.style = styles.filter(Boolean).join("; ");
	return properties;
};

// ###################
// A value can't end the <style> tag early
// ###################
const styleText = (value) => value.replace(/<\/(style)/gi, "<\\/$1");

// ###################
// Evaluator tree to real hast
// ###################
// ###################
// Plain one-line text for a warning { source, position, message }
// ###################
export const formatWarning = (w) => {
	const where = w.position ? `${w.source}:${w.position.line + 1}:${w.position.character + 1}` : w.source;
	return `⚠ ${where}  ${w.message}`;
};

export const toHast = (node, inSvg = false) => {
	switch (node.type) {
		case "root": {
			// ###################
			// Nothing may come before <!doctype html>, not even whitespace
			// ###################
			let children = node.children;
			const doctype = children.findIndex((c) => c.type === "element" && c.tagName.toLowerCase() === "doctype");
			if (doctype > 0 && children.slice(0, doctype).every((c) => c.type === "text" && !c.value.trim())) {
				children = children.slice(doctype);
			}
			return { type: "root", children: children.map((c) => toHast(c, inSvg)) };
		}
		case "text":
		case "raw":
		case "comment":
			return { type: node.type, value: node.value };
		case "runtime":
			return notYet(node);
		case "element": {
			if (node.tagName.toLowerCase() === "doctype") {
				if (node.children.length || Object.keys(node.properties).length) {
					throw new CompilerError("[doctype] takes no props or body; write [doctype!]", "");
				}
				return { type: "doctype" };
			}
			const svgHere = inSvg || node.tagName === "svg";
			const childSvg = svgHere && node.tagName !== "foreignObject";
			const exact = [];
			const out = {
				type: "element",
				tagName: node.tagName,
				properties: toProperties(node.properties, svgHere ? svg : html, node.tagName, node.data, exact),
				children: node.children.map((c) => {
					const out = toHast(c, childSvg);
					return node.tagName.toLowerCase() === "style" && out.type === "text" ? { ...out, value: styleText(out.value) } : out;
				})
			};
			if (exact.length) {
				const token = `${nonce}-${nextExact++}`;
				out.properties[EXACT] = token;
				out.data = { exact, token };
			}
			// ###################
			// hast keeps a <template>'s inside in "content", not in its children
			// ###################
			if (!svgHere && node.tagName.toLowerCase() === "template") {
				out.content = { type: "root", children: out.children };
				out.children = [];
			}
			return out;
		}
		default:
			throw new CompilerError(`unknown tree node ${node.type}`, "");
	}
};

// ###################
// Keys written as typed: in the HTML string, or on the built DOM
// ###################
const exactOf = (node, map = new Map()) => {
	if (node.data?.exact) map.set(node.data.token, node.data.exact);
	for (const c of node.children ?? []) exactOf(c, map);
	if (node.content) exactOf(node.content, map);
	return map;
};

const attrText = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export const writeExact = (htmlText, tree) => {
	const map = exactOf(tree);
	if (!map.size) return htmlText;
	return htmlText.replace(new RegExp(` ${EXACT}="(${nonce}-\\d+)"`, "g"), (m, token) =>
		map.has(token) ? map.get(token).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${attrText(v)}"`)).join("") : m
	);
};

export const setExact = (fragment, tree) => {
	const map = exactOf(tree);
	if (!map.size) return;
	for (const el of fragment.querySelectorAll(`[${EXACT}]`)) {
		const exact = map.get(el.getAttribute(EXACT)) ?? [];
		el.removeAttribute(EXACT);
		for (const [k, v] of exact) {
			try {
				el.setAttribute(k, v === true ? "" : v);
			} catch {}
		}
	}
};

// ###################
// Put the runtime bundle at the end of <body>, or of the page
// ###################
const bodyOf = (node) => {
	if (node.type === "element" && node.tagName === "body") return node;
	for (const c of node.children ?? []) {
		const hit = bodyOf(c);
		if (hit) return hit;
	}
	return null;
};

export const addScript = (tree, js) => {
	(bodyOf(tree) ?? tree).children.push({ type: "raw", value: `<script type="module">${js}</script>` });
};

// ###################
// <script type="module" src="…"> for a bundled file
// ###################
export const addScriptSrc = (tree, src) => {
	(bodyOf(tree) ?? tree).children.push({ type: "element", tagName: "script", properties: { type: "module", src }, children: [] });
};

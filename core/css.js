// ###################
// ArcMoon CSS: scoped component styles, one <style> in <head>
// ###################

import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { selectAll } from "css-select";

export class StyleError extends Error {
	constructor(message, source, position) {
		const where = position ? `${source}:${position.line + 1}:${position.character + 1}` : source;
		super(`${where}  ${message}`);
		this.name = "StyleError";
		this.source = source;
		this.position = position;
	}
}

const PSEUDO_ELEMENTS = new Set([":before", ":after", ":first-line", ":first-letter"]);
const isStyle = (n) => n.type === "element" && n.tagName.toLowerCase() === "style";

// ###################
// Short stable hash (FNV-1a) of a component's source
// ###################
export const scopeId = (text) => {
	let h = 0x811c9dc5;
	for (let k = 0; k < text.length; k++) {
		h ^= text.charCodeAt(k);
		h = Math.imul(h, 0x01000193);
	}
	return `data-a-${(h >>> 0).toString(36)}`;
};

// ###################
// Add [attr] to the last compound that isn't :global(); unwrap :global()
// ###################
const scopeSelector = (selector, attr) =>
	selectorParser((selectors) => {
		selectors.each((sel) => {
			const compounds = [[]];
			sel.each((node) => {
				if (node.type === "combinator") compounds.push([]);
				else compounds[compounds.length - 1].push(node);
			});

			const isGlobal = (c) => c.length > 0 && c.every((n) => n.type === "pseudo" && n.value === ":global");
			const target = [...compounds].reverse().find((c) => c.length && !isGlobal(c));

			if (target) {
				const pseudoAt = target.findIndex((n) => n.type === "pseudo" && (n.value.startsWith("::") || PSEUDO_ELEMENTS.has(n.value)));
				const attribute = selectorParser.attribute({ attribute: attr, raws: {} });
				if (pseudoAt === -1) sel.insertAfter(target[target.length - 1], attribute);
				else sel.insertBefore(target[pseudoAt], attribute);
			}

			sel.walkPseudos((p) => {
				if (p.value !== ":global") return;
				p.replaceWith(...p.nodes.flatMap((inner) => inner.nodes.map((n) => n.clone())));
			});
		});
	}).processSync(selector);

// ###################
// Rewrite every rule's selectors; @keyframes stay as they are
// ###################
// ###################
// Keyframes get the component's suffix (spin → spin-2kule8), and animation / animation-name
// in the same [style] follow; "-global-spin" stays global as "spin"
// ###################
const ANIMATION = /^(-webkit-)?animation(-name)?$/i;

const scopeKeyframes = (root, attr) => {
	const suffix = attr.replace(/^data-a-/, "");
	const renamed = new Map();
	root.walkAtRules(/keyframes$/i, (rule) => {
		const name = rule.params.trim();
		if (name.startsWith("-global-")) rule.params = name.slice("-global-".length);
		else if (name) {
			renamed.set(name, `${name}-${suffix}`);
			rule.params = `${name}-${suffix}`;
		}
	});
	if (!renamed.size) return;
	root.walkDecls(ANIMATION, (decl) => {
		decl.value = decl.value.replace(/[A-Za-z_][\w-]*/g, (word) => renamed.get(word) ?? word);
	});
};

const scopeCss = (css, attr) => {
	const root = postcss.parse(css);
	root.walkRules((rule) => {
		if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
		rule.selector = scopeSelector(rule.selector, attr);
	});
	scopeKeyframes(root, attr);
	return root.toString();
};

// ###################
// A line in a [style] body to a file position; line 1 starts after the unknown header end, so it stays at the tag
// ###################
export const inStyle = (position, line, character) =>
	position && line > 1 ? { line: position.line + line - 1, character } : position;

const cssText = (el) => el.children.map((c) => (c.type === "text" || c.type === "raw" ? c.value : "")).join("");

// ###################
// Page styles are global. A rule that styles the page's own elements and also
// elements written by a component (layout, card…) is most likely a name clash:
// warn, unless it uses :global() on purpose or only names elements (body, h1)
// ###################
const attrValue = (el, name) => {
	const v = el.properties?.[name] ?? el.properties?.[Object.keys(el.properties ?? {}).find((k) => k.toLowerCase() === name)];
	if (v === null || v === undefined || v === false || typeof v === "object") return undefined;
	return v === true ? "" : String(v);
};

const treeAdapter = (parents) => {
	const isTag = (n) => n?.type === "element";
	const children = (n) => n.children ?? [];
	const text = (n) => (n.type === "text" ? n.value : children(n).map(text).join(""));
	const inside = (outer, n) => {
		for (let p = parents.get(n); p; p = parents.get(p)) if (p === outer) return true;
		return false;
	};
	const findAll = (test, nodes, out = []) => {
		for (const n of nodes) {
			if (!isTag(n)) continue;
			if (test(n)) out.push(n);
			findAll(test, children(n), out);
		}
		return out;
	};
	return {
		isTag,
		getChildren: children,
		getParent: (n) => parents.get(n) ?? null,
		getSiblings: (n) => (parents.get(n) ? children(parents.get(n)) : [n]),
		getName: (n) => n.tagName.toLowerCase(),
		getAttributeValue: attrValue,
		hasAttrib: (n, name) => attrValue(n, name) !== undefined,
		getText: text,
		removeSubsets: (nodes) => nodes.filter((n, i) => nodes.indexOf(n) === i && !nodes.some((o) => o !== n && inside(o, n))),
		existsOne: (test, nodes) => findAll(test, nodes).length > 0,
		findAll: (test, nodes) => findAll(test, nodes),
		findOne: (test, nodes) => findAll(test, nodes)[0] ?? null
	};
};

// ###################
// Only the parts that change what an element is: hover, focus and ::before don't
// ###################
const KEEP_PSEUDO = new Set([":not", ":is", ":where", ":has", ":first-child", ":last-child", ":nth-child", ":nth-of-type", ":only-child", ":empty"]);
const forMatching = (selector) =>
	selectorParser((sels) => sels.walkPseudos((p) => { if (!KEEP_PSEUDO.has(p.value)) p.remove(); })).processSync(selector);

const namesSomething = (selector) => {
	let named = false;
	selectorParser((sels) => sels.each((sel) => {
		const last = [];
		sel.each((n) => (n.type === "combinator" ? (last.length = 0) : last.push(n)));
		if (last.some((n) => n.type === "class" || n.type === "id" || n.type === "attribute")) named = true;
	})).processSync(selector);
	return named;
};

const fileName = (id) => String(id).split(/[\\/]/).pop();

const pageLeaks = (tree, pageStyles, page) => {
	const warnings = [];
	const parents = new Map();
	const link = (node) => {
		for (const c of node.children ?? []) {
			parents.set(c, node);
			link(c);
		}
	};
	link(tree);
	const adapter = treeAdapter(parents);
	const roots = (tree.children ?? []).filter((n) => n.type === "element");
	const seen = new Set();
	for (const node of pageStyles) {
		let root;
		try {
			root = postcss.parse(cssText(node));
		} catch {
			continue;
		}
		root.walkRules((rule) => {
			if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
			for (const selector of rule.selectors) {
				if (selector.includes(":global") || seen.has(selector) || !namesSomething(selector)) continue;
				let found;
				try {
					found = selectAll(forMatching(selector), roots, { adapter });
				} catch {
					continue;
				}
				const others = [...new Set(found.map((el) => el.data?.source).filter((s) => s && s !== page))];
				if (!others.length || !found.some((el) => el.data?.source === page)) continue;
				seen.add(selector);
				warnings.push({
					source: page,
					position: inStyle(node.data?.position, rule.source?.start?.line ?? 1, (rule.source?.start?.column ?? 1) - 1),
					message: `"${selector}" in the page's [style] also styles elements in ${others.map(fileName).join(", ")}. Page styles are global: use a class only this page uses, or write :global(${selector}) if that's on purpose`
				});
			}
		});
	}
	return warnings;
};

// ###################
// :global(…) in a page's [style] only marks a rule as meant for the whole page
// ###################
const unwrapGlobal = (node) => {
	if (!node.children.every((c) => c.type === "text" || c.type === "raw")) return;
	const text = cssText(node);
	if (!text.includes(":global(")) return;
	const root = postcss.parse(text);
	root.walkRules((rule) => {
		if (!rule.selector.includes(":global(")) return;
		rule.selector = selectorParser((sels) => sels.walkPseudos((p) => {
			if (p.value === ":global") p.replaceWith(...p.nodes.flatMap((inner) => inner.nodes.map((n) => n.clone())));
		})).processSync(rule.selector);
	});
	node.children = [{ type: "text", value: root.toString() }];
};

// ###################
// Scope styles in components (every module but the page), then move them into <head>
// Changes the tree in place; returns warnings
// ###################
export default function scopeStyles(tree, graph) {
	const warnings = [];
	const attrs = new Map();
	const sheets = new Map();

	const attrOf = (id) => {
		if (!attrs.has(id)) attrs.set(id, scopeId(graph.modules.get(id)?.src ?? id));
		return attrs.get(id);
	};

	// ###################
	// 1. Take component [style]s out of the tree, first use's CSS wins
	// ###################
	const scoped = new Set();
	const pageStyles = [];
	const collect = (children) => {
		for (let k = 0; k < children.length; k++) {
			const node = children[k];
			if (node.type !== "element") continue;
			const source = node.data?.source;
			if (isStyle(node) && source === graph.entry && !node.data?.directives?.["arcm-raw"]) pageStyles.push(node);
			if (isStyle(node) && source && source !== graph.entry) {
				children.splice(k--, 1);
				scoped.add(source);
				const extra = Object.keys(node.properties).filter((key) => !/^\d+$/.test(key));
				if (extra.length) warnings.push({ source, position: node.data.position, message: `props on a component's [style] are ignored (${extra.join(", ")})` });
				let css;
				try {
					css = scopeCss(cssText(node), attrOf(source));
				} catch (err) {
					throw new StyleError(`CSS error in [style]: ${err.reason ?? err.message}`, source, inStyle(node.data.position, err.line, err.column - 1));
				}
				const seen = sheets.get(source);
				if (seen === undefined) sheets.set(source, css.trim());
				else if (seen !== css.trim()) warnings.push({ source, position: node.data.position, message: "[style] gives different CSS for different uses of this component; only the first is kept. Use -- props for values that differ per use" });
				continue;
			}
			collect(node.children);
		}
	};
	collect(tree.children);
	warnings.push(...pageLeaks(tree, pageStyles, graph.entry));
	pageStyles.forEach(unwrapGlobal);
	if (!scoped.size) return warnings;

	// ###################
	// 2. Mark each element written in a styled component
	// ###################
	const mark = (children) => {
		for (const node of children) {
			if (node.type !== "element" || node.tagName.toLowerCase() === "doctype") continue;
			if (scoped.has(node.data?.source)) node.properties[attrOf(node.data.source)] = true;
			mark(node.children);
		}
	};
	mark(tree.children);

	// ###################
	// 3. One <style>; data.sheets keeps each component's CSS for bundling
	// ###################
	const style = { type: "element", tagName: "style", properties: {}, children: [{ type: "text", value: [...sheets.values()].join("\n") }], data: { directives: {}, sheets: [...sheets].map(([source, css]) => ({ source, css })) } };
	addToHead(tree, style);
	return warnings;
}

// ###################
// End of <head>, or the start of the page (after <!doctype>)
// ###################
const headOf = (children) => {
	for (const node of children) {
		if (node.type !== "element") continue;
		if (node.tagName.toLowerCase() === "head") return node;
		const hit = headOf(node.children);
		if (hit) return hit;
	}
	return null;
};

const addToHead = (tree, node) => {
	const head = headOf(tree.children);
	if (head) return head.children.push(node);
	const doctype = tree.children.findIndex((c) => c.type === "element" && c.tagName.toLowerCase() === "doctype");
	tree.children.splice(doctype + 1, 0, node);
};

export const addStyle = (tree, css) => addToHead(tree, { type: "element", tagName: "style", properties: {}, children: [{ type: "text", value: css }], data: { directives: {} } });
export const addStyleHref = (tree, href) => addToHead(tree, { type: "element", tagName: "link", properties: { rel: "stylesheet", href }, children: [], data: { directives: {} } });

const isLocal = (href) => typeof href === "string" && href !== "" && !/^([a-z][a-z\d+.-]*:|\/\/|#)/i.test(href);
const LINK_PROPS = new Set(["rel", "href", "type"]);
const SCOPE_ATTR = /^data-a-[0-9a-z]+$/;

// ###################
// Take the page's CSS out of the tree, in page order, for bundling:
// local [link = rel: "stylesheet"] files and [style] blocks, then component CSS last
// Left in place: [style] with live values, props or arcm-raw, [style] inside [svg], links with other props
// → [{ file, source, position } | { css, source, position }]
// ###################
export function collectStyles(tree) {
	const pieces = [];
	const scoped = [];

	// ###################
	// Take a node out; a line it had alone goes too (like §5.7)
	// ###################
	const remove = (children, k) => {
		children.splice(k, 1);
		const before = children[k - 1];
		const after = children[k];
		const isText = (n) => n?.type === "text";
		const lineStart = !before || (isText(before) && (/\n[ \t]*$/.test(before.value) || (k - 1 === 0 && /^[ \t]*$/.test(before.value))));
		const lineEnd = !after || (isText(after) && /^[ \t]*(\r?\n|$)/.test(after.value));
		if (!lineStart || !lineEnd) return;
		if (isText(before)) before.value = before.value.replace(/[ \t]*$/, "");
		if (isText(after)) after.value = after.value.replace(/^[ \t]*\r?\n?/, "");
	};

	const visit = (children, inSvg) => {
		for (let k = 0; k < children.length; k++) {
			const node = children[k];
			if (node.type !== "element") continue;
			const tag = node.tagName.toLowerCase();
			const props = Object.keys(node.properties).filter((key) => !/^\d+$/.test(key) && !SCOPE_ATTR.test(key));
			const { source, position } = node.data ?? {};

			if (tag === "link" && !inSvg && isLocal(node.properties.href) && String(node.properties.rel ?? "").split(/\s+/).includes("stylesheet") && props.every((key) => LINK_PROPS.has(key))) {
				pieces.push({ file: node.properties.href, source, position });
				remove(children, k--);
				continue;
			}
			if (tag === "style" && !inSvg && !props.length && node.data?.directives?.raw !== true && node.children.every((c) => c.type === "text" || c.type === "raw")) {
				if (node.data?.sheets) scoped.push(...node.data.sheets.map((s) => ({ css: s.css, source: s.source, position: null })));
				else pieces.push({ css: cssText(node), source, position });
				remove(children, k--);
				continue;
			}
			visit(node.children, inSvg || tag === "svg");
		}
	};
	visit(tree.children, false);
	return [...pieces, ...scoped];
}

// ###################
// arcmoon/reactive: signals for runtime code, built on alien-signals
// ###################

import { effect as baseEffect, effectScope, setActiveSub, signal } from "alien-signals";

export { signal, computed } from "alien-signals";

// ###################
// Only a returned function is kept as cleanup
// ###################
export const effect = (fn) =>
	baseEffect(() => {
		const result = fn();
		return typeof result === "function" ? result : undefined;
	});

// ###################
// Live [for-each] (used by ArcMoon's generated code, not part of arcmoon/reactive's API).
// One row per item, in list order, before the <template>. With a key, a row stays with its
// item: rows are added, removed and moved, never redrawn. Rows written at build time
// (<!--arcm-row:key-->) are adopted. Each row's values run in its own effect scope,
// stopped when the row goes away
// ###################
const COMMENT = 8;
const ELEMENT = 1;

// a row value's place inside the row's own nodes: the <!--arcm:id--> before live text, or an element
const findIn = (nodes, target) => {
	for (const n of nodes) {
		if (target.text) {
			if (n.nodeType === COMMENT && n.data === `arcm:${target.id}`) return n;
			if (n.nodeType !== ELEMENT) continue;
			const walker = document.createTreeWalker(n, NodeFilter.SHOW_COMMENT);
			for (let c = walker.nextNode(); c; c = walker.nextNode()) if (c.data === `arcm:${target.id}`) return c;
		} else if (n.nodeType === ELEMENT) {
			const selector = `[data-arcm-in="${target.id}"]`;
			if (n.matches(selector)) return n;
			const found = n.querySelector(selector);
			if (found) return found;
		}
	}
	return null;
};

// live text: a fresh text node between <!--arcm:id--> and <!--/arcm-->
const textAfter = (mark) => {
	while (mark.nextSibling && !(mark.nextSibling.nodeType === COMMENT && mark.nextSibling.data === "/arcm")) mark.nextSibling.remove();
	const node = document.createTextNode("");
	mark.after(node);
	return node;
};

const rowKey = (k) => encodeURIComponent(JSON.stringify(k));

// rows written at build time: after <!--arcm-each:id-->, each starts at <!--arcm-row:key-->.
// A key written twice (a list with duplicate keys) leaves the earlier row in extra, to remove.
// A loop that is the very first thing on a page loses its first comments: browsers move comments
// before the first element out of <body>. Then the nodes before the first row comment are a
// row whose key is gone: extra too (drawn again)
const writtenRows = (template, id) => {
	const before = [];
	let n = template.previousSibling;
	for (; n && !(n.nodeType === COMMENT && n.data === `arcm-each:${id}`); n = n.previousSibling) before.unshift(n);
	const rows = new Map();
	const extra = [];
	let current = n ? null : [];
	if (current) extra.push(current);
	for (const n of before) {
		if (n.nodeType === COMMENT && n.data.startsWith("arcm-row:")) {
			const k = n.data.slice(9);
			if (rows.has(k)) extra.push(rows.get(k));
			rows.set(k, (current = [n]));
		} else if (current) current.push(n);
	}
	return { rows, extra };
};

export const each = ({ template, id, key, inner }, list, rowFn) => {
	const parent = template.parentNode;
	const { rows: written, extra } = writtenRows(template, id);
	let rows = new Map();

	const makeRow = (item, index, k) => {
		const nodes = written.get(rowKey(k)) ?? [...template.content.cloneNode(true).childNodes];
		written.delete(rowKey(k));
		// the item is boxed, so the row's values update whenever the list does (even when
		// an item was changed in place)
		const row = { key: k, nodes, item: signal({ v: item }), index: signal(index) };
		const api = { item: () => row.item().v, index: () => row.index() };
		row.stop = effectScope(() =>
			rowFn(api, (j, bind) => {
				const place = findIn(nodes, inner[j]);
				if (place) bind(inner[j].text ? textAfter(place) : place);
			})
		);
		return row;
	};

	const update = (items) => {
		const next = [];
		const keys = new Set();
		items.forEach((item, index) => {
			let k = key === null ? index : item?.[key];
			if (keys.has(k)) {
				console.error(`ArcMoon: live [for-each] has the key ${JSON.stringify(k)} twice; each item's ${key} must be different`);
				k = { duplicate: index };
			}
			keys.add(k);
			const row = rows.get(k);
			if (row) {
				row.item({ v: item });
				row.index(index);
				next.push(row);
			} else next.push(makeRow(item, index, k));
		});
		const kept = new Set(next);
		for (const row of rows.values()) {
			if (kept.has(row)) continue;
			row.stop();
			row.nodes.forEach((n) => n.remove());
		}
		// build-time rows the browser's list doesn't have
		for (const nodes of [...written.values(), ...extra.splice(0)]) nodes.forEach((n) => n.remove());
		written.clear();
		// place the rows in order before the <template>, moving only those out of place
		let before = template;
		for (let j = next.length - 1; j >= 0; j--) {
			const { nodes } = next[j];
			if (!nodes.length) continue;
			if (nodes[nodes.length - 1].nextSibling !== before || nodes[0].parentNode !== parent) {
				for (const n of nodes) parent.insertBefore(n, before);
			}
			before = nodes[0];
		}
		rows = new Map(next.map((row) => [row.key, row]));
	};

	// the list is read inside the effect (so it re-runs when the list changes); the rows are
	// made outside it, so their effects belong to their own scopes, not to this effect
	baseEffect(() => {
		const items = Array.from(list() ?? []);
		const prev = setActiveSub(undefined);
		try {
			update(items);
		} finally {
			setActiveSub(prev);
		}
	});
};

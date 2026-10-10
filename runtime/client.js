// ###################
// ArcMoon in the browser: refs, live values, one run per use
// ###################

let comments = null;

// ###################
// <!--arcm:id--> comments that mark live text
// ###################
const liveComment = (id) => {
	if (!comments) {
		comments = new Map();
		const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			if (n.data.startsWith("arcm:")) comments.set(n.data.slice(5), n);
		}
	}
	return comments.get(id);
};

// ###################
// Where elements are found: the whole page, or elements render() already built
// ###################
const pageDom = {
	byRef: (id) => [...document.querySelectorAll(`[data-arcm-ref~="${id}"]`)],
	liveComment
};

// ###################
// Set an attribute the same way the compiler writes it
// ###################
const setAttr = (el, name, value) => {
	if (name.startsWith("--") || name.startsWith("css.")) {
		const prop = name.startsWith("css.") ? name.slice(4) : name;
		if (value === null || value === undefined || value === false) el.style.removeProperty(prop);
		else el.style.setProperty(prop, String(value));
		return;
	}
	if (name === "value" || name === "checked") el[name] = value;
	if (value === null || value === undefined || value === false) el.removeAttribute(name);
	else el.setAttribute(name, value === true ? "" : String(value));
};

export const run = (fn, use, dom = pageDom) => {
	const ArcMoon = Object.freeze({
		version: use.version,
		defineRef(name) {
			const ref = use.refs[name];
			if (!ref) throw new Error(`defineRef("${name}"): no element has arcm-ref "${name}"`);
			return ref;
		},
		ref(ref) {
			if (ref.shared) throw new Error(`"${ref.name}" is a shared ref; use ArcMoon.refs()`);
			return dom.byRef(ref.id)[0] ?? null;
		},
		refs(ref) {
			if (!ref.shared) throw new Error(`"${ref.name}" is a single ref; use ArcMoon.ref()`);
			if (!ref.ids) return dom.byRef(ref.id);
			// ###################
			// Shared refs collected from several components, in page order
			// ###################
			return ref.ids.flatMap((id) => dom.byRef(id)).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
		}
	});

	const live = (k, bind) => {
		for (const target of use.live[k] ?? []) {
			if (target.part !== undefined) {
				// ###################
				// Live text inside <style>: rebuild the whole CSS text
				// ###################
				const el = dom.byRef(target.id)[0];
				const parts = use.styles?.[target.id];
				if (!el || !parts) continue;
				bind({ set data(v) { parts[target.part] = v; el.textContent = parts.join(""); } });
			} else if (target.text) {
				// ###################
				// Live text sits between <!--arcm:id--> and <!--/arcm-->
				// ###################
				const mark = dom.liveComment(target.id);
				if (!mark) continue;
				while (mark.nextSibling && !(mark.nextSibling.nodeType === Node.COMMENT_NODE && mark.nextSibling.data === "/arcm")) {
					mark.nextSibling.remove();
				}
				const node = document.createTextNode("");
				mark.after(node);
				bind(node);
			} else {
				const el = dom.byRef(target.id)[0];
				if (el) bind(el);
			}
		}
	};

	try {
		fn(ArcMoon, use.values, live, setAttr);
	} catch (err) {
		console.error(`ArcMoon runtime error in ${use.file}`, err);
	}
};

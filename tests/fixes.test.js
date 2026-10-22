// ###################
// 1.1 warnings and fixes (ArcMoon.md §16): each test fails without its fix
// ###################

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import ArcMoon from "../node/compiler.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

// the HTML (no script) and the warnings, as "line:col  message" (or the message alone)
const build = async (src) => {
	const warnings = [];
	const html = await new ArcMoon({ src, cwd: FIXTURES, onWarning: (w) => warnings.push(w.position ? `${w.position.line + 1}:${w.position.character + 1}  ${w.message}` : w.message) }).compile();
	return { html: html.split("<script")[0], warnings, script: /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "" };
};
const warned = async (src) => (await build(src)).warnings;

describe("B27: content in a void element", () => {
	it("warns; [img !] and an empty body don't", async () => {
		expect(await warned(`[img = src: "a.png"]x[end]`)).toEqual([`1:1  [img] can't have content (<img> is a void element); write [img = … !]`]);
		expect(await warned(`[img = src: "a.png" !][input][end][br]\n[end]`)).toEqual([]);
	});
});

describe("B28: unknown arcm- props", () => {
	it("warns with the closest directive", async () => {
		expect(await warned(`[p = arcm-rwa: true]x[end]`)).toEqual([`1:1  arcm-rwa is not an ArcMoon directive, so it does nothing (did you mean arcm-raw?); directives are arcm-raw, arcm-ref, arcm-shared-ref and arcm-syntax`]);
		expect(await warned(`[p = arcm-syntax: "css"]x[end]`)).toEqual([]);
	});
});

describe("B29: [for-each] over something that isn't a list", () => {
	it("warns once for an object or a number; lists, strings, Sets, Maps and null are fine", async () => {
		expect(await warned(`[for-each = \${ { a: 1 } }\$][p]x[end][end]`)).toEqual([`1:1  [for-each] needs a list, but got an object, so it shows nothing; for an object use Object.entries(…), for a count use Array.from({ length: n }, (_, k) => k)`]);
		expect((await warned(`[for-each = \${ 3 }\$][p]x[end][end]`))[0]).toMatch(/got a number/);
		const ok = await build(`[for-each = \${ "ab" }\$]\${ value }\$[end][for-each = \${ new Set([1]) }\$]\${ value }\$[end][for-each = \${ new Map([[2, 3]]) }\$]\${ value[0] }\$[end][for-each = \${ null }\$]x[end]`);
		expect([ok.warnings, ok.html]).toEqual([[], "ab12"]);
	});
});

describe("B30: [A] is written as <a>", () => {
	it("lowercases capitalized HTML names; SVG names keep their case", async () => {
		const { html } = await build(`[A = href: "/"]x[end][svg][foreignObject][P]y[end][end][end]`);
		expect(html).toBe(`<a href="/">x</a><svg><foreignObject><p>y</p></foreignObject></svg>`);
	});
});

describe("B33 and B40: [slot]", () => {
	it("props on [slot] warn; so does [slot] in a page", async () => {
		expect(await warned(`[slot = name: "head" !]`)).toEqual([
			`1:1  [slot] takes no props (name); there is one slot per component, pass other areas as props`,
			`1:1  [slot] in a page shows nothing but its fallback: a page has no caller. Use [slot] in components`
		]);
	});
});

describe("B37: the [doctype] error has a file and position", () => {
	it("points at the block", async () => {
		await expect(build(`[p]x[end]\n[doctype = lang: "en" !]`)).rejects.toThrow(/anonymous\.arcm:2:1 {2}\[doctype\] takes no props or body/);
	});
});

describe("B38: [doctype!] after content", () => {
	it("warns after content or inside a block, not when first", async () => {
		expect(await warned(`[p]x[end]\n[doctype!]`)).toEqual([`2:1  [doctype!] comes after other content (line 1); it must be first, or browsers draw the page in quirks mode`]);
		expect(await warned(`[html][doctype!][end]`)).toEqual([`1:7  [doctype!] inside another block is written there; it must be first, at the top of the page`]);
		expect(await warned(`# a comment\n\${ const x = 1; }\$\n[doctype!]\n[html][end]`)).toEqual([]);
	});
});

describe("B39: unknown props on [for-each]", () => {
	it("warns, with a hint; key: only on a live loop", async () => {
		expect(await warned(`[for-each = \${ [1] }\$, ass: "n"]x[end]`)).toEqual([`1:1  ass: on [for-each] does nothing (did you mean as:?)`]);
		expect(await warned(`[for-each = \${ [1] }\$, as: "n", key: "id"]x[end]`)).toEqual([`1:1  key: only works on a live [for-each] (its list in runtime \${ }$); here it does nothing`]);
		expect(await warned(`runtime \${ import { signal } from "arcmoon/reactive"; const l = signal([]); }\$\n[div][for-each = runtime \${ l() }\$, as: "n", key: "id"]x[end][end]`)).toEqual([]);
	});
});

describe("B41: a signal without ()", () => {
	it("warns in text, attributes and a live list; not as an event handler", async () => {
		const head = `runtime \${ import { signal, computed } from "arcmoon/reactive"; const count = signal(0); const big = computed(() => count() > 5); const items = signal([]); }\$\n`;
		const w = await warned(`${head}[p = title: runtime \${ big }\$]runtime \${ count }\$[end][div][for-each = runtime \${ items }\$]x[end][end][button = onclick: runtime \${ count }\$]+[end]`);
		expect(w.map((m) => m.replace(/^\d+:\d+ {2}/, ""))).toEqual([`"big" is a signal; read it with big()`, `"count" is a signal; read it with count()`, `"items" is a signal; read it with items()`]);
		expect(await warned(`${head}[p]runtime \${ count() }\$[end]`)).toEqual([]);
	});
});

describe("B42: a name only another file's runtime code declares", () => {
	it("warns in the component that uses the page's name", async () => {
		const warnings = [];
		await new ArcMoon({ src: `[import = Themed: "./components/Themed.arcm" !]\nruntime \${ const theme = "dark"; }\$\n[Themed !]`, cwd: FIXTURES, onWarning: (w) => warnings.push(`${w.source.split(/[\\/]/).pop()} ${w.message}`) }).compile();
		expect(warnings).toEqual([`Themed.arcm "theme" is declared in anonymous.arcm's runtime code, not here; each file has its own scope, so here it is undefined in the browser`]);
	});
});

describe("B25: event-only pages don't ship the signals library", () => {
	it("a page whose only live values are events has no signals code", async () => {
		const events = await build(`runtime \${ const hi = () => alert("hi"); }\$\n[button = onclick: runtime \${ hi }\$]x[end]`);
		const text = await build(`runtime \${ import { signal } from "arcmoon/reactive"; const n = signal(1); }\$\n[p]runtime \${ n() }\$[end]`);
		expect(text.script).toContain("pendingValue");
		expect(events.script).not.toContain("pendingValue");
		expect(events.script.length).toBeLessThan(text.script.length / 2);
	});
});

describe("13: non-ASCII text without <meta charset>", () => {
	it("warns once; not with a charset, not for ASCII only", async () => {
		expect(await warned(`[p]Salaan × [end]`)).toEqual([`the page has non-ASCII text (like "×") but no <meta charset="utf-8">, so browsers may show it wrong (like "Ã—" for "×"). Add [meta = charset: "utf-8" !] at the top of the page (inside [head] if it has one)`]);
		expect(await warned(`[p = title: "é"]x[end]`)).toHaveLength(1);
		expect(await warned(`[head][meta = charset: "utf-8" !][end][p]× é[end]`)).toEqual([]);
		expect(await warned(`[p]Salaan[end]`)).toEqual([]);
	});
});

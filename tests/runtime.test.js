// ###################
// Runtime logic tests: bundle runs in jsdom
// ###################

import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import ArcMoon from "../node/compiler.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

const compile = (src, options = {}) => new ArcMoon({ src, cwd: FIXTURES, ...options }).compile();

// ###################
// jsdom doesn't run module scripts; the bundle has no import/export left
// ###################
const open = (html) => new JSDOM(html.replace(`<script type="module">`, "<script>"), { runScripts: "dangerously" }).window.document;

const PAGE =
	`[import = Counter: "./components/Counter.arcm" !]\n` +
	`\${ export const title = "Runtime"; export const when = new Date(0); }\$\n` +
	`[html][body]\n` +
	`[h1 = arcm-ref: "title"]\${ title }\$[end:h1]\n` +
	`[span = arcm-shared-ref: "items"]1[end:span][span = arcm-shared-ref: "items"]2[end:span]\n` +
	`[Counter = start: 5 !][Counter = start: 10 !]\n` +
	`[end:body][end:html]\n` +
	`runtime \${\n` +
	`  ArcMoon.ref(ArcMoon.defineRef("title")).dataset.ok = title + "|" + when.getTime();\n` +
	`  ArcMoon.refs(ArcMoon.defineRef("items")).forEach((s) => (s.dataset.n = "x" + s.textContent));\n` +
	`}\$`;

describe("runtime", () => {
	it("puts one module script at the end of <body>", async () => {
		const html = await compile(PAGE);
		expect(html.match(/<script type="module">/g)).toHaveLength(1);
		expect(html).toMatch(/<\/script><\/body><\/html>\n?$/);
	});

	it("writes unique ref ids and initial live values", async () => {
		const html = await compile(PAGE);
		expect(html).toContain(`<h1 data-arcm-ref="title-u0">`);
		expect(html).toContain(`<span data-arcm-ref="items-u0">1</span><span data-arcm-ref="items-u0">2</span>`);
		expect(html).toContain(`<button data-arcm-ref="btn-u1"><!--arcm:t0-->5<!--/arcm--></button>`);
		expect(html).toContain(`<button data-arcm-ref="btn-u2"><!--arcm:t1-->10<!--/arcm--></button>`);
	});

	it("runs refs, exported values and live values in the browser", async () => {
		const doc = open(await compile(PAGE));
		const [a, b] = doc.querySelectorAll("button");
		a.click();
		b.click();
		b.click();
		expect(a.textContent).toBe("6");
		expect(b.textContent).toBe("12");
		expect(a.className).toBe("cold");
		expect(b.className).toBe("hot");
		expect(a.dataset.ready).toBe("yes");
		expect(doc.querySelector("h1").dataset.ok).toBe("Runtime|0");
		expect([...doc.querySelectorAll("span")].map((s) => s.dataset.n)).toEqual(["x1", "x2"]);
	});

	it("leaves arcmoon/reactive out of pages without live values or signals", async () => {
		const refOnly = await compile(`[div = arcm-ref: "r"][end]\nruntime \${ ArcMoon.ref(ArcMoon.defineRef("r")).textContent = 5; }\$`);
		const live = await compile(`runtime \${ const sum = 5; }\$\n[div]runtime \${ sum }\$[end]`);
		expect(refOnly).not.toMatch(/depsTail/);
		expect(live).toMatch(/depsTail/);
		expect(open(refOnly).querySelector("div").textContent).toBe("5");
		expect(open(live).querySelector("div").textContent).toBe("5");
	});

	it("sends an exported import to runtime code", async () => {
		const doc = open(await compile(`\${ import { name } from "./data.json"; export { name }; }\$\n[p]runtime \${ name }\$[end]`));
		expect(doc.querySelector("p").textContent).toBe("demo");
	});

	it("keeps the text around a live value", async () => {
		const doc = open(await compile(`runtime \${ const n = 94; }\$\n[p]before runtime \${ n }\$ after[end]`));
		expect(doc.querySelector("p").textContent).toBe("before 94 after");
		const named = open(await compile(`runtime \${ const el = "e"; const n = "n"; const on = () => {}; }\$\n[p = title: runtime \${ el }\$, onclick: runtime \${ on }\$]\${ "x" }\$runtime \${ n }\$[end]`));
		expect(named.querySelector("p").title).toBe("e");
		expect(named.querySelector("p").textContent).toBe("xn");
	});

	it("warns about a likely typo in a live value", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await compile(`runtime \${ import { signal } from "arcmoon/reactive"; const count = signal(0); }\$\n[p]runtime \${ cout() }\$ runtime \${ innerWidth }\$[end]`);
		const messages = warn.mock.calls.map((c) => c[0]);
		warn.mockRestore();
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatch(/"cout" is not defined in this file's runtime code \(did you mean "count"\?\)/);
	});

	it("doesn't warn about names a live value declares itself", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await compile(`runtime \${ import { signal } from "arcmoon/reactive"; const on = signal(""); }\$\n[input = oninput: runtime \${ (e) => on(e.target.value) }\$ !][p]runtime \${ on() }\$[end]`);
		const messages = warn.mock.calls.map((c) => c[0]);
		warn.mockRestore();
		expect(messages).toEqual([]);
	});

	it.each([
		[`[b = arcm-ref: "x"]1[end]\n  [i = arcm-ref: "x"]2[end]\nruntime \${ ArcMoon.defineRef("x"); }\$`, /anonymous\.arcm:2:3 {2}single ref "x"/],
		[`[p]a[end]\nruntime \${\n  import c from "canvas-confetti";\n}\$`, /anonymous\.arcm:3:17 {2}runtime import "canvas-confetti" is not listed/],
		[`[p]a[end]\nruntime \${ import fs from "node:fs"; }\$`, /anonymous\.arcm:2:27 {2}runtime import "node:fs"/],
		[`\${ export const f = () => 1; }\$[p]a[end]\nruntime \${ const x = 1;\n  f(); }\$`, /anonymous\.arcm:3:3 {2}"f" is a function/],
		[`\${ const secret = 1; }\$\n[p]runtime \${ secret }\$[end]`, /anonymous\.arcm:2:15 {2}runtime code uses "secret"/],
		[`\${ const xs = [1]; }\$\n[for-each = \${ xs }\$, as: "item"][p]runtime \${ item }\$[end][end]`, /anonymous\.arcm:2:48 {2}runtime code uses "item", a \[for-each\] name that only exists at build time/],
		[`\${ const xs = [1]; }\$\n[for-each = \${ xs }\$][p = onclick: runtime \${ () => i }\$]x[end][end]`, /runtime code uses "i", a \[for-each\] name/],
		[`[b = arcm-shared-ref: "it"]1[end]\nruntime \${ const r = ArcMoon.defineRef("it"); ArcMoon.ref(r); }\$`, /anonymous\.arcm:2:47 {2}ArcMoon\.ref\(\) used with shared ref/]
	])("points runtime errors at the exact spot: %s", async (src, message) => {
		await expect(compile(src)).rejects.toThrow(message);
	});

	it("warns once about a large exported value", async () => {
		const onWarning = vi.fn();
		await compile(`\${ export const big = "x".repeat(60000); export const small = 1; }\$\n[p]a[end]\nruntime \${ console.log(big.length, small); }\$`, { onWarning });
		const large = onWarning.mock.calls.map((c) => c[0]).filter((w) => /exported value/.test(w.message));
		expect(large).toEqual([{ source: expect.stringMatching(/anonymous\.arcm$/), position: { line: 2, character: 23 }, message: `exported value "big" is 58.6 kB; it is copied into the page's JS for each use. Export only what runtime code needs` }]);
	});

	it("names files relative to the project, never by absolute path", async () => {
		const html = await compile(`runtime \${ const x = 1; }\$\n[p]a[end]`, { filename: "page.arcm" });
		expect(html).toContain(`file:"page.arcm"`);
		expect(html).not.toContain(FIXTURES);
	});

	it("lets runtime code declare its own i, next to a [for-each]", async () => {
		const html = await compile(`\${ const xs = [1, 2]; }\$\n[for-each = \${ xs }\$, as: "item"][p = data-item: \${ item }\$]\${ i }\$[end][end]\nruntime \${ for (let i = 0; i < 2; i++) console.log(i); }\$`);
		expect(html).toContain(`<p data-item="1">0</p>`);
	});

	it("adds no script when there is no runtime code", async () => {
		expect(await compile(`[p]a[end]`)).toBe(`<p>a</p>`);
	});

	it("warns about refs no runtime code uses", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await compile(`[p = arcm-ref: "lonely"]a[end]`);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(`arcm-ref "lonely" is never used`));
		warn.mockRestore();
	});

	it.each([
		[`\${ const secret = "x"; }\$[p]a[end]\nruntime \${ console.log(secret); }\$`, /uses "secret", which is not exported/],
		[`\${ import { name } from "./data.json"; }\$[p]runtime \${ name }\$[end]`, /uses "name", which is not exported .*export \{ name \}/],
		[`[b = arcm-ref: "my-btn"]x[end]\nruntime \${ ArcMoon.defineRef("my-bnt"); }\$`, /matches no arcm-ref .*did you mean "my-btn"/],
		[`[b = arcm-ref: "x"]1[end][b = arcm-ref: "x"]2[end]\nruntime \${ ArcMoon.defineRef("x"); }\$`, /single ref "x" is attached to 2 elements/],
		[`[b = arcm-shared-ref: "it"]1[end]\nruntime \${ const r = ArcMoon.defineRef("it"); ArcMoon.ref(r); }\$`, /ArcMoon\.ref\(\) used with shared ref "it"/],
		[`[p]a[end]\nruntime \${ import c from "canvas-confetti"; c(); }\$`, /"canvas-confetti" is not listed in bundle/],
		[`[p]a[end]\nruntime \${ import fs from "node:fs"; }\$`, /"node:fs" is a Node\.js module/],
		[`\${ export const f = () => 1; }\$[p]a[end]\nruntime \${ f(); }\$`, /"f" is a function/],
		[`[p]a[end]\nruntime \${ export const x = 1; }\$`, /export is not allowed in runtime code/],
		[`[div]runtime \${ import { a } from "./a.js"; a(); }\$[end]`, /runtime \$\{ \}\$ inside \[div\] must be one expression .*\n.*move this runtime \$\{ \}\$ to the top level/],
		[`[p = class: runtime \${ const a = 1; a }\$]x[end]`, /runtime \$\{ \}\$ for "class" on \[p\] must be one expression/]
	])("rejects %s", async (src, message) => {
		await expect(compile(src)).rejects.toThrow(message);
	});
});

describe("names inside functions and blocks (B17)", () => {
	const run = async (src) => open(await compile(src)).defaultView;

	it("sends an exported value that a parameter of the same name only hides inside its function", async () => {
		const win = await run(`\${ export const who = "Ada"; }\$\n[p]a[end]\nruntime \${\n  const greet = (who) => \`Hi \${who}\`;\n  window.seen = [who, greet("Bo")];\n}\$`);
		expect(win.seen).toEqual(["Ada", "Hi Bo"]);
	});

	it("stops the build when the outside name is not exported, at the real use", async () => {
		await expect(compile(`\${ const who = "Ada"; }\$\n[p]a[end]\nruntime \${\n  const greet = (who) => who;\n  console.log(who);\n}\$`)).rejects.toThrow(
			/anonymous\.arcm:5:15 {2}runtime code uses "who", which is not exported/
		);
	});

	it("knows every inner scope: blocks, loops, catch, inner var, class names, defaults", async () => {
		const win = await run(
			`\${ export const a = 1, b = 2, c = 3, d = 4, e = 5, f = 6; }\$\n[p]x[end]\nruntime \${\n` +
				`  { const a = 0; }\n` +
				`  for (const b of [0]) {}\n` +
				`  try { throw 0; } catch (c) {}\n` +
				`  function inner() { var d = 0; return d; }\n` +
				`  const K = class e { m() { return e; } };\n` +
				`  const g = ({ x = f } = {}) => x;\n` +
				`  window.seen = [a, b, c, d, e, g(), inner()];\n}\$`
		);
		expect(win.seen).toEqual([1, 2, 3, 4, 5, 6, 0]);
	});

	it("lets a top-level runtime name win over a build-time one", async () => {
		const win = await run(`\${ const who = "build"; }\$\n[p]a[end]\nruntime \${ const who = "browser"; window.seen = who; }\$`);
		expect(win.seen).toBe("browser");
	});
});

describe("exported values used only in import() (B18)", () => {
	it("sends the value", async () => {
		const html = await compile(`\${ export const url = "./lib-b18.js"; }\$\n[p]a[end]\nruntime \${ window.load = () => import(url); }\$`);
		expect(html).toContain(`"./lib-b18.js"`);
	});

	it("stops the build when the value is not exported", async () => {
		await expect(compile(`\${ const url = "./lib.js"; }\$\n[p]a[end]\nruntime \${ import(url); }\$`)).rejects.toThrow(
			/anonymous\.arcm:3:19 {2}runtime code uses "url", which is not exported/
		);
	});
});

describe("live values on elements with a shared ref (B21)", () => {
	const src = `runtime \${
  window.clicked = [];
  window.count = ArcMoon.refs(ArcMoon.defineRef("item")).length;
}\$
[button = arcm-shared-ref: "item", onclick: runtime \${ () => window.clicked.push("A") }\$, title: runtime \${ "first" }\$]A[end]
[button = arcm-shared-ref: "item", onclick: runtime \${ () => window.clicked.push("B") }\$]B[end]
[p = arcm-ref: "one", title: runtime \${ "single" }\$]x[end]
runtime \${ ArcMoon.defineRef("one"); }\$`;

	it("each element runs its own handler, and refs() still finds all of them", async () => {
		const html = await compile(src);
		const win = open(html).defaultView;
		const [a, b] = win.document.querySelectorAll("button");
		b.click();
		a.click();
		expect(win.clicked).toEqual(["B", "A"]);
		expect(win.count).toBe(2);
		expect(a.getAttribute("title")).toBe("first");
		expect(b.hasAttribute("title")).toBe(false);
	});

	it("gives a shared-ref element an id of its own; a single ref keeps one id", async () => {
		const html = await compile(src);
		expect(html).toMatch(/<button data-arcm-ref="item-u\d+ e\d+">A<\/button>/);
		expect(html).toMatch(/<p data-arcm-ref="one-u\d+">x<\/p>/);
	});
});

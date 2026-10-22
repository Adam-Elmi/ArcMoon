// ###################
// Live [for-each]: rows written at build time, adopted in the browser, kept by key,
// updated with the list; errors for what isn't supported inside it
// ###################

import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import ArcMoon from "../node/compiler.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

const compile = (src, options = {}) => new ArcMoon({ src, cwd: FIXTURES, ...options }).compile();

// jsdom doesn't run module scripts; the bundle has no import/export left
const open = (html, before = (h) => h) => {
	const dom = new JSDOM(before(html).replace(`<script type="module">`, "<script>"), { runScripts: "dangerously" });
	return { doc: dom.window.document, window: dom.window };
};

const SIGNAL = `import { signal } from "arcmoon/reactive";`;

const TODOS =
	`runtime \${\n` +
	`  ${SIGNAL}\n` +
	`  const todos = signal([{ id: 1, title: "Akhri", done: false }, { id: 2, title: "Qor", done: true }, { id: 3, title: "Xisaab", done: false }]);\n` +
	`  window.todos = todos;\n` +
	`  window.remove = (id) => todos(todos().filter((t) => t.id !== id));\n` +
	`}\$\n` +
	`[ul][for-each = runtime \${ todos() }\$, as: "todo", key: "id"]` +
	`[li = class: runtime \${ todo.done ? "done" : "" }\$, data-id: runtime \${ todo.id }\$]` +
	`runtime \${ i + 1 }\$. runtime \${ todo.title }\$` +
	`[input !]` +
	`[button = onclick: runtime \${ () => remove(todo.id) }\$]x[end]` +
	`[end][end][end]`;

const rows = (doc) => [...doc.querySelectorAll("li")].map((li) => `${li.firstChild ? li.textContent : ""}|${li.className}`);

describe("live [for-each]: rows at build time", () => {
	it("writes the first rows into the HTML when the list is a literal", async () => {
		const html = await compile(TODOS);
		const body = html.split("<script")[0];
		expect(body).toContain(`<!--arcm-row:1--><li data-arcm-in="e1" class="" data-id="1"><!--arcm:t2-->1<!--/arcm-->. <!--arcm:t3-->Akhri<!--/arcm-->`);
		expect(body).toContain(`class="done"`);
		expect(body.match(/<li /g)).toHaveLength(3 + 1);
		expect(body).toMatch(/<template data-arcm-ref="e0"><li data-arcm-in="e1"><!--arcm:t2--><!--\/arcm-->/);
	});

	it("writes rows for an exported list, using exported values too", async () => {
		const html = await compile(
			`\${ export const books = [{ id: "a", title: "Hal Abuur", pages: 212 }]; export const unit = "bog"; }\$\n` +
				`runtime \${ ${SIGNAL} const list = signal(books); }\$\n` +
				`[for-each = runtime \${ list() }\$, as: "book", key: "id"][p]runtime \${ book.title }\$, runtime \${ book.pages + " " + unit }\$[end][end]`
		);
		expect(html.split("<script")[0]).toContain(`<p><!--arcm:t1-->Hal Abuur<!--/arcm-->, <!--arcm:t2-->212 bog<!--/arcm--></p>`);
	});

	it("leaves out values that need other runtime code; the script fills them", async () => {
		const src =
			`runtime \${ ${SIGNAL} const names = signal(["a", "b"]); const shout = (s) => s.toUpperCase(); const mark = signal("!"); }\$\n` +
			`[div][for-each = runtime \${ names() }\$, as: "name"][p]runtime \${ shout(name) }\$runtime \${ name + mark() }\$runtime \${ Math.max(i, 1) }\$[end][end][end]`;
		const html = await compile(src);
		expect(html.split("<script")[0]).toContain(`<p><!--arcm:t1--><!--/arcm--><!--arcm:t2--><!--/arcm--><!--arcm:t3-->1<!--/arcm--></p>`);
		const { doc } = open(html);
		expect([...doc.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Aa!1", "Bb!1"]);
	});

	it("writes no rows when the list isn't known at build time", async () => {
		const html = await compile(`runtime \${ ${SIGNAL} const n = signal(2); const list = () => Array.from({ length: n() }, (_, k) => k); }\$\n[for-each = runtime \${ list() }\$, as: "x"][p]runtime \${ x }\$[end][end]`);
		expect(html.split("<script")[0]).not.toContain("arcm-row");
		const { doc } = open(html);
		expect([...doc.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["0", "1"]);
	});

	it("a loop first on the page (its first comments move out of <body>) still shows each row once", async () => {
		const html = await compile(`runtime \${ ${SIGNAL} const names = signal(["a", "b"]); window.names = names; }\$\n[for-each = runtime \${ names() }\$, as: "name"][p]runtime \${ name }\$[end][end]`);
		const { doc, window } = open(html);
		expect([...doc.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["a", "b"]);
		window.names(["c"]);
		expect([...doc.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["c"]);
	});

	it("adopts the build-time rows instead of drawing them again", async () => {
		const { doc } = open(await compile(TODOS), (h) => h.replaceAll(`data-id="1">`, `data-id="1" data-kept="yes">`));
		expect(rows(doc)).toEqual(["1. Akhrix|", "2. Qorx|done", "3. Xisaabx|"]);
		expect(doc.querySelector("li").dataset.kept).toBe("yes");
	});
});

describe("live [for-each] in the browser", () => {
	it("adds, removes and moves rows by key, keeping their elements", async () => {
		const { doc, window } = open(await compile(TODOS));
		const [a, b, c] = doc.querySelectorAll("li");
		window.todos([...window.todos(), { id: 4, title: "Ciyaar", done: false }]);
		expect(rows(doc)).toEqual(["1. Akhrix|", "2. Qorx|done", "3. Xisaabx|", "4. Ciyaarx|"]);
		window.remove(2);
		expect(rows(doc)).toEqual(["1. Akhrix|", "2. Xisaabx|", "3. Ciyaarx|"]);
		const [a2, c2] = doc.querySelectorAll("li");
		expect([a2 === a, c2 === c]).toEqual([true, true]);
		window.todos([...window.todos()].reverse());
		expect(rows(doc)).toEqual(["1. Ciyaarx|", "2. Xisaabx|", "3. Akhrix|"]);
		expect(doc.querySelectorAll("li")[2]).toBe(a);
		expect(b.isConnected).toBe(false);
	});

	it("keeps focus in a row when other rows are added or removed", async () => {
		const { doc, window } = open(await compile(TODOS));
		const input = doc.querySelectorAll("input")[2];
		input.focus();
		input.value = "typing";
		window.remove(1);
		window.todos([{ id: 0, title: "Hore", done: false }, ...window.todos()]);
		expect(doc.activeElement).toBe(input);
		expect(input.value).toBe("typing");
	});

	it("events use the row's current item", async () => {
		const { doc } = open(await compile(TODOS));
		doc.querySelectorAll("button")[1].click();
		expect(rows(doc)).toEqual(["1. Akhrix|", "2. Xisaabx|"]);
		doc.querySelectorAll("button")[1].click();
		expect(rows(doc)).toEqual(["1. Akhrix|"]);
	});

	it("updates row values when an item changes, also in place", async () => {
		const { doc, window } = open(await compile(TODOS));
		window.todos(window.todos().map((t) => (t.id === 1 ? { ...t, done: true } : t)));
		expect(rows(doc)[0]).toBe("1. Akhrix|done");
		const list = window.todos();
		list[2].title = "Taariikh";
		window.todos([...list]);
		expect(rows(doc)[2]).toBe("3. Taariikhx|");
	});

	it("without a key, rows follow positions", async () => {
		const html = await compile(`runtime \${ ${SIGNAL} const names = signal(["a", "b", "c"]); window.names = names; }\$\n[div][for-each = runtime \${ names() }\$, as: "name"][p]runtime \${ name }\$[end][end][end]`);
		const { doc, window } = open(html);
		const first = doc.querySelector("p");
		window.names(["c", "b"]);
		expect([...doc.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["c", "b"]);
		expect(doc.querySelector("p")).toBe(first);
		window.names([]);
		expect(doc.querySelectorAll("p")).toHaveLength(0);
		window.names(["x"]);
		expect(doc.querySelector("p").textContent).toBe("x");
	});

	it("stops a removed row's effects", async () => {
		const html = await compile(
			`runtime \${ ${SIGNAL} const items = signal([1, 2]); const mark = signal("-"); window.items = items; window.mark = mark; window.runs = [];\n` +
				`  const seen = (x) => (window.runs.push(x), x); }\$\n` +
				`[div][for-each = runtime \${ items() }\$, as: "x"][p]runtime \${ seen(x) + mark() }\$[end][end][end]`
		);
		const { window } = open(html);
		window.items([1]);
		window.runs.length = 0;
		window.mark("+");
		expect(window.runs).toEqual([1]);
	});

	it("reports a duplicate key and still shows every item", async () => {
		const html = await compile(`runtime \${ ${SIGNAL} const list = signal([{ id: 1 }, { id: 1 }]); }\$\n[div][for-each = runtime \${ list() }\$, as: "x", key: "id"][p]runtime \${ x.id }\$[end][end][end]`);
		const errors = [];
		const dom = new JSDOM(html.replace(`<script type="module">`, "<script>"), { runScripts: "dangerously", beforeParse: (w) => (w.console.error = (...a) => errors.push(a.join(" "))) });
		expect(dom.window.document.querySelectorAll("p")).toHaveLength(2);
		expect(errors.join()).toMatch(/has the key 1 twice/);
	});

	it("shared refs in rows: ArcMoon.refs() returns the current rows", async () => {
		const html = await compile(
			`runtime \${ ${SIGNAL} const names = signal(["a", "b"]); window.names = names;\n` +
				`  window.count = () => ArcMoon.refs(ArcMoon.defineRef("row")).length; }\$\n` +
				`[div][for-each = runtime \${ names() }\$, as: "name"][p = arcm-shared-ref: "row"]runtime \${ name }\$[end][end][end]`
		);
		const { window } = open(html);
		expect(window.count()).toBe(2);
		window.names(["a", "b", "c"]);
		expect(window.count()).toBe(3);
	});

	it("works inside components: each use has its own list, and scoped styles reach the rows", async () => {
		const html = await compile(`[import = Todos: "./components/Todos.arcm" !]\n[Todos = items: ${"${"} [{ id: 1, title: "one" }] }$ !][Todos !]`);
		const body = html.split("<script")[0];
		expect(body).toMatch(/<!--arcm-row:1-->\s*<li data-a-\w+><!--arcm:t\d+-->one<!--\/arcm--><\/li>/);
		const { doc } = open(html);
		const [first, second] = doc.querySelectorAll("ul");
		second.querySelector("button").click();
		expect(first.querySelectorAll("li")).toHaveLength(1);
		expect([...second.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["new"]);
		expect([...second.querySelector("li").attributes].some((a) => a.name.startsWith("data-a-"))).toBe(true);
	});

	it("builds with --dev (source maps)", async () => {
		const html = await compile(TODOS, { dev: true });
		const { doc } = open(html);
		expect(rows(doc)).toHaveLength(3);
	});
});

describe("live [for-each]: errors", () => {
	it("its names in ${ }$", async () => {
		await expect(compile(`runtime \${ ${SIGNAL} const l = signal([]); }\$\n[for-each = runtime \${ l() }\$, as: "todo"][p]\${ todo.title }\$[end][end]`)).rejects.toThrow(
			/"todo" only exists in the browser, inside a live \[for-each\]: use runtime \$\{ todo \}\$/
		);
		await expect(compile(`runtime \${ ${SIGNAL} const l = signal([]); }\$\n[for-each = runtime \${ l() }\$, as: "todo"][p]\${ i }\$[end][end]`)).rejects.toThrow(/"i" only exists in the browser/);
	});

	it("components, nested live loops, [slot], arcm-ref, [script]", async () => {
		const head = `runtime \${ ${SIGNAL} const l = signal([]); }\$\n`;
		await expect(compile(`[import = Tag: "./components/Tag.arcm" !]\n${head}[for-each = runtime \${ l() }\$, as: "x"][Tag !][end]`)).rejects.toThrow(/\[Tag\] inside a live \[for-each\]: components aren't supported there yet/);
		await expect(compile(`${head}[for-each = runtime \${ l() }\$, as: "x"][for-each = runtime \${ l() }\$, as: "y"][p]a[end][end][end]`)).rejects.toThrow(/a live \[for-each\] inside another live \[for-each\]/);
		await expect(compile(`${head}[for-each = runtime \${ l() }\$, as: "x"][slot!][end]`)).rejects.toThrow(/\[slot\] inside a live \[for-each\]/);
		await expect(compile(`${head}[for-each = runtime \${ l() }\$, as: "x"][p = arcm-ref: "row"]a[end][end]`)).rejects.toThrow(/arcm-ref on \[p\] inside a live \[for-each\] would be on every row/);
		await expect(compile(`${head}[for-each = runtime \${ l() }\$, as: "x"][script = src: "./scripts/a.js" !][end]`)).rejects.toThrow(/\[script\] inside a live \[for-each\]/);
	});

	it("a row value that isn't one expression", async () => {
		await expect(compile(`runtime \${ ${SIGNAL} const l = signal([]); }\$\n[for-each = runtime \${ l() }\$, as: "x"][p]runtime \${ let a = 1; }\$[end][end]`)).rejects.toThrow(/must be one expression/);
	});

	it("a build-time [for-each] inside a live one still works", async () => {
		const html = await compile(`runtime \${ ${SIGNAL} const l = signal(["a"]); }\$\n[for-each = runtime \${ l() }\$, as: "x"][p][for-each = \${ [1, 2] }\$, as: "n"]\${ n }\$[end][end][end]`);
		expect(html.split("<script")[0]).toContain("<p>12</p>");
	});
});

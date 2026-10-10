// ###################
// Compiler + evaluator tests: .arcm to HTML
// ###################

import { describe, it, expect, vi } from "vitest";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ArcMoon from "../node/compiler.js";
import pkg from "../package.json" with { type: "json" };

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

const compile = (src, options = {}) => new ArcMoon({ src, cwd: FIXTURES, ...options }).compile();
const flat = (html) => html.replace(/\s*\n\s*/g, "");

describe("compile: markup", () => {
	it("writes elements, attributes and text", async () => {
		const html = await compile(`[main = id: "m", class: "a  b", data-count: 2][p]Hi[end:p][end:main]`);
		expect(flat(html)).toBe(`<main id="m" class="a b" data-count="2"><p>Hi</p></main>`);
	});

	it("writes keys exactly as typed (B12)", async () => {
		const html = await compile(`[div = "data:x": "1", dataX: "2", datax: "a&\\"b", dataFlag: true, aria-label: "L", "xml:lang": "so" !][svg = viewBox: "0 0 1 1"][circle = dataQ: "q" !][end]`);
		expect(html).toBe(`<div aria-label="L" xml:lang="so" data:x="1" dataX="2" datax="a&amp;&quot;b" dataFlag></div><svg viewBox="0 0 1 1"><circle dataQ="q"></circle></svg>`);
	});

	it("refuses attribute names that break HTML (B13)", async () => {
		const bad = /on \[p\] is not a valid attribute name: it can't contain spaces, quotes, ">", "\/", "=" or control characters/;
		await expect(compile(`[p = "a b": "1" !]`)).rejects.toThrow(bad);
		await expect(compile(`[p = "x=y": "1" !]`)).rejects.toThrow(bad);
		await expect(compile(`[p = "say\\"hi": "1" !]`)).rejects.toThrow(bad);
		await expect(compile(`[p = "a b": runtime \${ 1 }\$ !]`)).rejects.toThrow(bad);
		await expect(compile(`[p = "": "1" !]`)).rejects.toThrow(/"" on \[p\] is not a valid attribute name: it can't be empty/);
		expect(await compile(`[p = "xml:lang": "so", "[f]": "1", @click: "a" !]`)).toBe(`<p xml:lang="so" [f]="1" @click="a"></p>`);
		await expect(compile(`[import = Card: "./components/Card.arcm" !][Card = title: "T", "a b": "1" !]`)).rejects.toThrow(/"a b" on \[div\] is not a valid attribute name/);
	});

	it("keeps the body of a [template]", async () => {
		expect(await compile(`[template = id: "row"][li = class: "item"][span]x[end][end][end]`)).toBe(`<template id="row"><li class="item"><span>x</span></li></template>`);
	});

	it("handles booleans, numbers and void elements", async () => {
		const html = await compile(`[input = type: "checkbox", checked: true, disabled: false !][img = src: "a.png", width: 100 !]`);
		expect(html).toBe(`<input type="checkbox" checked><img src="a.png" width="100">`);
	});

	it("escapes text and attributes with named references", async () => {
		const html = await compile(`[p = title: "a \\"q\\" & x"]\${ "<b> & c" }\$[end]`);
		expect(html).toBe(`<p title="a &quot;q&quot; &amp; x">&lt;b> &amp; c</p>`);
	});

	it("writes [doctype!] as <!doctype html>", async () => {
		expect(await compile(`[Doctype !]\n[html][end]`)).toBe(`<!doctype html>\n<html></html>`);
		await expect(compile(`[doctype = x: 1 !]`)).rejects.toThrow(/\[doctype\] takes no props or body/);
	});

	it("writes { raw } as HTML", async () => {
		expect(await compile(`[p]\${ { raw: "<em>x</em>" } }\$[end]`)).toBe(`<p><em>x</em></p>`);
	});

	it("keeps SVG attribute names", async () => {
		const html = await compile(`[svg = viewBox: "0 0 10 10"][circle = stroke-width: 2 !][end]`);
		expect(html).toBe(`<svg viewBox="0 0 10 10"><circle stroke-width="2"></circle></svg>`);
	});

	it("removes comments unless asked to keep them", async () => {
		expect(await compile(`# hi\n[p]a[end]`)).toBe(`<p>a</p>`);
		expect(await compile(`# hi\n[p]a[end]`, { removeComments: false })).toBe(`<!-- hi-->\n<p>a</p>`);
	});
});

describe("compile: lines with no output", () => {
	it("removes lines that hold only imports, silent ${ }$ blocks, runtime blocks or comments", async () => {
		const src = [
			`[import = Card: "./components/Card.arcm" !]`,
			`\${`,
			`  const n = 2;`,
			`}\$`,
			`runtime \${ const r = 1; }\$`,
			`# a note`,
			`[main]`,
			`  \${ const inner = 1; }\$`,
			`  [p]\${ n }\$[end]`,
			``,
			`  [p]b[end]`,
			`[end]`
		].join("\n");
		const html = await compile(src);
		expect(html.split("<script")[0]).toBe(`<main>\n  <p>2</p>\n\n  <p>b</p>\n</main>`);
	});

	it("does the same for files with Windows line endings (\\r\\n), keeping them in the output", async () => {
		const src = [`[import = Card: "./components/Card.arcm" !]`, `\${ const n = 2; }\$`, `# a note`, `[main]`, `  [p]\${ n }\$[end]`, `[end]`].join("\r\n");
		const html = await compile(src);
		expect(html).toBe(`<main>\r\n  <p>2</p>\r\n</main>`);
	});

	it("keeps lines where a ${ }$ outputs something, or other content shares the line", async () => {
		expect(await compile(`\${ 1 + 1 }\$\n[p]a[end]`)).toBe(`2\n<p>a</p>`);
		expect(await compile(`x \${ const a = 1; }\$\n[p]a[end]`)).toBe(`x \n<p>a</p>`);
		expect(await compile(`[import = C: "./components/Card.arcm" !] [import = D: "./components/Bad.arcm" !]\n[p]a[end]`)).toBe(`<p>a</p>`);
	});

	it("puts nothing before <!doctype html>", async () => {
		expect(await compile(`\n\n  [doctype!]\n[html][end]`)).toBe(`<!doctype html>\n<html></html>`);
	});
});

describe("compile: ${ }$ in Node.js", () => {
	it("shares top-level variables and outputs the last value", async () => {
		expect(await compile(`\${ const n = 21; }\$[p]\${ n * 2 }\$[end]`)).toBe(`<p>42</p>`);
	});

	it("supports return, arrays, null and false", async () => {
		expect(await compile(`[p]\${ return "a" }\$\${ [1, null, false, "b"] }\$[end]`)).toBe(`<p>a1b</p>`);
	});

	it("imports node: modules and npm packages", async () => {
		const html = await compile(`\${ import { basename } from "node:path"; import * as acorn from "acorn"; }\$[p]\${ basename("/a/b.txt") }\$ \${ typeof acorn.parse }\$[end]`);
		expect(html).toBe(`<p>b.txt function</p>`);
	});

	it("imports .json like runtime code does: default, named and namespace", async () => {
		expect(await compile(`\${ import { version as v, name } from "./data.json"; }\$[p]\${ name }\$@\${ v }\$[end]`)).toBe(`<p>demo@2.5.0</p>`);
		expect(await compile(`\${ import data from "./data.json"; import * as all from "./data.json"; }\$[p]\${ data.version }\$ \${ all.name }\$[end]`)).toBe(`<p>2.5.0 demo</p>`);
		expect(await compile(`\${ import data from "./data.json" with { type: "json" }; }\$[p]\${ data.name }\$[end]`)).toBe(`<p>demo</p>`);
	});

	it("scopes variables to their element", async () => {
		await expect(compile(`[div]\${ const x = 1; }\$[end]\${ x }\$`)).rejects.toThrow(/x is not defined/);
	});

	it("reads page props and ArcMoon.version", async () => {
		const html = await compile(`\${ const { name } = ArcMoon.props(); }\$[p]\${ name }\$ \${ ArcMoon.version }\$[end]`, { props: { name: "Adam" } });
		expect(html).toBe(`<p>Adam ${pkg.version}</p>`);
	});

	it("gives an element's own props inside it", async () => {
		expect(await compile(`[p = title: "t"]\${ ArcMoon.props().title }\$[end]`)).toBe(`<p title="t">t</p>`);
	});

	it("loops with for-each and i", async () => {
		const html = await compile(`[ul][for-each = \${ ["a", "b"] }\$, as: "x"][li]\${ i }\$:\${ x }\$[end][end][end]`);
		expect(html).toBe(`<ul><li>0:a</li><li>1:b</li></ul>`);
	});

	it("leaves no temporary files", async () => {
		await compile(`[p]\${ 1 }\$[end]`);
		expect((await readdir(FIXTURES)).filter((f) => f.startsWith(".arcm-"))).toEqual([]);
	});
});

describe("compile: components", () => {
	it("passes props, slots and unread props", async () => {
		const html = await compile(
			`[import = Card: "./components/Card.arcm" !]\n` +
			`[for-each = \${ [{ t: "A", tone: "blue" }, { t: "<B>" }] }\$, as: "p"][Card = title: \${ p.t }\$, tone: \${ p.tone }\$, id: \${ "c" + i }\$]Item \${ i }\$[end:Card][end]`
		);
		expect(flat(html)).toBe(
			`<div class="card card-blue" id="c0"><h2>A</h2>Item 0</div>` +
			`<div class="card card-gray" id="c1"><h2>&lt;B></h2>Item 1</div>`
		);
	});

	it("uses import aliases", async () => {
		const html = await compile(`[import = Card: "@/Card.arcm" !][Card = title: "T" !]`, { importAliases: { "@": "./components" } });
		expect(flat(html)).toBe(`<div class="card card-gray"><h2>T</h2></div>`);
	});
});

describe("compile: unknown tag warnings", () => {
	const warnings = async (src) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await compile(src);
			return warn.mock.calls.map((c) => c[0].replace(/^.*anonymous\.arcm:/, ""));
		} finally {
			warn.mockRestore();
		}
	};

	it("warns with a suggestion for typos and misspelled components", async () => {
		expect(await warnings(`[import = Card: "./components/Card.arcm" !]\n[dvi]a[end][Crad!][zzqq!]`)).toEqual([
			"2:1  [dvi] is not an HTML element or an imported component (did you mean [div]?)",
			"2:12  [Crad] is not an HTML element or an imported component (did you mean [Card]?)",
			"2:19  [zzqq] is not an HTML element or an imported component"
		]);
	});

	it("warns when a capitalized block that isn't imported is written as HTML", async () => {
		expect(await warnings(`[A !][B]x[end][a]y[end][Doctype !]`)).toEqual([
			`1:1  [A] is not imported; it is written as <a>. Did you forget [import = A: "./A.arcm" !]?`,
			`1:6  [B] is not imported; it is written as <b>. Did you forget [import = B: "./B.arcm" !]?`
		]);
	});

	it("warns about positional values on HTML elements, not on components (B14)", async () => {
		expect(await warnings(`[import = Card: "./components/Card.arcm" !]\n[div = "first", id: "x" !][p = "a", 3, \${ 1 }\$]x[end][Card = "x", title: "T" !]`)).toEqual([
			`2:1  positional value "first" on [div] is not used; HTML elements only take named props (key: value)`,
			`2:27  positional values "a", 3, \${ … }\$ on [p] are not used; HTML elements only take named props (key: value)`
		]);
	});

	it("warns when ArcMoon.props() inside an element reads a prop it doesn't have", async () => {
		const w = await warnings(`[div][h2 = id: "t"]\${ ArcMoon.props().title }\$ \${ ArcMoon.props().id }\$[end][end]`);
		expect(w).toEqual([`1:22  ArcMoon.props() inside [h2] returns the [h2]'s props, which have no "title"; for the component's props, call it at the top of the file`]);
	});

	it("warns when a ${ name }$ output is undefined", async () => {
		const w = await warnings(`\${ const { title } = ArcMoon.props(); const obj = {}; }\$[p]\${ title }\$ \${ obj.name }\$ \${ obj.x ?? "ok" }\$[end]`);
		expect(w).toEqual([
			`1:62  \${ title }\$ is undefined (prop "title" wasn't passed)`,
			`1:74  \${ obj.name }\$ is undefined`
		]);
		expect(await warnings(`\${ const { title } = ArcMoon.props(); }\$[p]\${ title }\$[end]`)).toHaveLength(1);
	});

	it("accepts HTML, SVG, MathML, custom elements, doctype and components", async () => {
		expect(await warnings(
			`[import = Card: "./components/Card.arcm" !]\n[Doctype !][section][svg][foreignObject][end][clippath][end][end][math][mrow][end][end][my-widget][end][Card = title: "x" !][end]`
		)).toEqual([]);
	});
});

describe("compile: errors point to the .arcm file", () => {
	it.each([
		[`[import = Bad: "./components/Bad.arcm" !][Bad!]`, /Bad\.arcm:2:24 {2}TypeError: Cannot read properties of null/],
		[`[p]\${ ArcMoon.defineRef("x") }\$[end]`, /anonymous\.arcm:1:15 {2}Error: ArcMoon\.defineRef\(\) is only available in runtime blocks/],
		[`\${\n  const a = 1;\n  a.b.c\n}\$`, /anonymous\.arcm:3:7 /],
		[`\${ const a = ; }\$`, /anonymous\.arcm:1:14 {2}SyntaxError/],
		[`[p = title: \${ null.x }\$]a[end]`, /anonymous\.arcm:1:21 /],
		[`[import = L: "./components/Loop.arcm" !][L!]`, /circular import/],
		[`\${ if (1) { return 2 } }\$`, /return is only allowed as the last statement/],
		[`\${ ({ a: 1 }) }\$`, /can't render \[object Object\]/],
		[`[div]\${ add(2,3) }\$[end]`, /anonymous\.arcm:1:9 {2}ReferenceError: add is not defined/],
		[`\${ import x from "not-a-real-pkg"; }\$`, /anonymous\.arcm {2}can't find package "not-a-real-pkg"; run npm install not-a-real-pkg/],
		[`\${ import x from "./nope.js"; }\$`, /anonymous\.arcm {2}can't find file ".*nope\.js"/]
	])("%s", async (src, message) => {
		await expect(compile(src)).rejects.toThrow(message);
	});
});

describe("compile: regex literals in ${ }$", () => {
	it.each([
		[`[p]\${ "a\\"b".replace(/"/g, "x") }\$[end]`, "<p>axb</p>"],
		[`[p]\${ "x}\$y".replace(/}\\$/, "-") }\$[end]`, "<p>x-y</p>"],
		[`[p]\${ "a/b".replace(/[/]/g, "-") }\$[end]`, "<p>a-b</p>"],
		[`[p]\${ const r = /a"b/i; return r.flags }\$[end]`, "<p>i</p>"],
		[`[p]\${ typeof /x/ }\$[end]`, "<p>object</p>"]
	])("skips the regex in %s", async (src, html) => {
		expect(await compile(src)).toBe(html);
	});

	it.each([
		[`[p]\${ 10 / 2 }\$[end]`, "<p>5</p>"],
		[`[p]\${ (4 + 6) / 2 / 1 }\$[end]`, "<p>5</p>"],
		[`[p]\${ [10][0] / 5 }\$[end]`, "<p>2</p>"],
		[`[p]\${ 6 / 2 + "px" }\$[end]`, "<p>3px</p>"]
	])("still divides in %s", async (src, html) => {
		expect(await compile(src)).toBe(html);
	});
});

describe("compile: hints in confusing errors", () => {
	it("points at a # comment that swallowed an [end]", async () => {
		await expect(compile(`[p]Issue #5 is fixed[end]`)).rejects.toThrow(
			/\[p\] opened at 1:1 is missing \[end\]\. The "#" on line 1 starts a comment, which hides the rest of that line, including its \[end\]\. For the character itself, write \\#/
		);
		await expect(compile(`[div]\n  [li]I like C# a lot[end]\n[end:div]`)).rejects.toThrow(/does not match \[li\] opened at 2:3\. The "#" on line 2 starts a comment/);
	});

	it("says nothing extra when no comment hid an [end]", async () => {
		const error = await compile(`[p]a[end]\n# a normal comment\n[div]`).catch((e) => e);
		expect(error.message).toMatch(/is missing \[end\]$/);
	});

	it("suggests \\runtime when runtime ${ comes right after a word in text", async () => {
		await expect(compile(`\${ const x = 1; }\$\n[p]The runtime \${ x }\$ value[end]`)).rejects.toThrow(/If you meant the word "runtime" before a build-time value, write \\runtime \$\{ … \}\$\./);
		const plain = await compile(`\${ const x = 1; }\$\n[p]runtime \${ x }\$[end]`).catch((e) => e);
		expect(plain.message).not.toMatch(/If you meant the word/);
	});
});

describe("compile: a component's final line break", () => {
	const withFiles = async (files, run) => {
		const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const dir = await mkdtemp(join(tmpdir(), "arcmoon-final-break-"));
		try {
			for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
			return await run((src) => new ArcMoon({ src, cwd: dir }).compile());
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	};

	it("is not output, so inline components don't add a space to the sentence", async () => {
		await withFiles(
			{
				"Link.arcm": `\${ const { text } = ArcMoon.props(); }\$\n[a]\${ text }\$[end]\n`,
				"Styled.arcm": `[b]x[end]\n[style]\n  b { color: red }\n[end]\n`,
				"Crlf.arcm": `[i]y[end]\r\n`
			},
			async (compile) => {
				const html = await compile(`[import = Link: "./Link.arcm" !]\n[import = Styled: "./Styled.arcm" !]\n[import = Crlf: "./Crlf.arcm" !]\n[p]See [Link = text: "Syntax" !], [Styled!]. [Crlf!]![end]`);
				expect(html).toMatch(/<p>See <a>Syntax<\/a>, <b data-a-[a-z0-9]+>x<\/b>\. <i>y<\/i>!<\/p>/);
			}
		);
	});

	it("drops only that one break; a page keeps its own", async () => {
		await withFiles({ "Block.arcm": `[div]\n  [p]in[end]\n[end]\n\n` }, async (compile) => {
			expect(await compile(`[import = Block: "./Block.arcm" !]\n[main][Block!][end]`)).toBe(`<main><div>\n  <p>in</p>\n</div>\n</main>`);
			expect(await compile(`[p]a[end]\n`)).toBe(`<p>a</p>\n`);
		});
	});
});

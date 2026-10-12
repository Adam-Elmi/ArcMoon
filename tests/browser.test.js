// ###################
// Browser compile tests: the worker's code, run with data: URLs in Node.js
// ###################

import { describe, it, expect, vi, afterEach } from "vitest";
import { compileInWorker } from "../browser/compile.js";

const toModuleURL = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const compile = (request) => compileInWorker(request, { toModuleURL });

// ###################
// Text of the tree, for short checks
// ###################
const text = (node) => {
	if (node.type === "text") return node.value;
	if (node.type === "raw") return node.value;
	if (node.type === "element") return `<${node.tagName}>${node.children.map(text).join("")}</${node.tagName}>`;
	if (node.type === "root") return node.children.map(text).join("");
	return "";
};

afterEach(() => vi.unstubAllGlobals());

describe("browser compile", () => {
	it("compiles src with ${ }$ and page props", async () => {
		const r = await compile({ src: `\${ const { name } = ArcMoon.props(); }\$[p]Hi \${ name }\$ \${ 20 + 1 }\$[end]`, props: { name: "Adam" }, version: "9.9.9" });
		expect(text(r.tree)).toBe("<p>Hi Adam 21</p>");
	});

	it("loads components, JSON and JS from virtual files", async () => {
		const r = await compile({
			filename: "pages/index.arcm",
			files: {
				"pages/index.arcm": `[import = Card: "../components/Card.arcm" !]\n\${ import { add } from "../lib/add.js"; import { name } from "../data.json"; }\$[Card = title: \${ name }\$]\${ add(2, 3) }\$[end]`,
				"components/Card.arcm": `\${ const { title } = ArcMoon.props(); }\$[div][h2]\${ title }\$[end][slot!][end]`,
				"lib/add.js": `import { double } from "./double.js";\nexport const add = (a, b) => double(a + b) / 2;`,
				"lib/double.js": `export const double = (x) => x * 2;`,
				"data.json": `{ "name": "demo" }`
			}
		});
		expect(text(r.tree).trim()).toBe("<div><h2>demo</h2>5</div>");
	});

	it.each(["./", ".", "/"])(`resolves an import alias to the root (%s) without "//"`, async (target) => {
		const r = await compile({
			filename: "main.arcm",
			importAliases: { "@": target },
			files: {
				"main.arcm": `[import = Custom: "@/custom.arcm" !][Custom!]`,
				"custom.arcm": `[b]custom[end]`
			}
		});
		expect(text(r.tree).trim()).toBe("<b>custom</b>");
	});

	it("fetches files from baseUrl", async () => {
		const fetch = vi.fn(async (url) => ({ ok: true, status: 200, text: async () => (String(url).endsWith("Card.arcm") ? "[b]fetched[end]" : "") }));
		vi.stubGlobal("fetch", fetch);
		const r = await compile({ src: `[import = Card: "./Card.arcm" !][Card!]`, baseUrl: "https://example.com/site/" });
		expect(text(r.tree)).toBe("<b>fetched</b>");
		expect(String(fetch.mock.calls[0][0])).toBe("https://example.com/site/Card.arcm");
	});

	it("gives node:path, node:events, node:buffer and node:url", async () => {
		const r = await compile({
			src: `\${ import { join } from "node:path"; import { EventEmitter } from "node:events"; import { Buffer } from "node:buffer"; import { fileURLToPath } from "node:url"; }\$` +
				`[p]\${ join("/a", "b") }\$ \${ typeof new EventEmitter().on }\$ \${ Buffer.from("hi").toString("hex") }\$ \${ fileURLToPath("file:///x/y") }\$[end]`
		});
		expect(text(r.tree)).toBe("<p>/a/b function 6869 /x/y</p>");
	});

	it("reads virtual files with node:fs", async () => {
		const r = await compile({
			src: `\${ import { readFile } from "node:fs/promises"; import { readFileSync, existsSync } from "node:fs"; const md = await readFile("posts/a.md", "utf8"); }\$[p]\${ md }\$ \${ readFileSync("/posts/a.md", "utf8") }\$ \${ String(existsSync("nope.md")) }\$[end]`,
			files: { "posts/a.md": "hello" }
		});
		expect(text(r.tree)).toBe("<p>hello hello false</p>");
	});

	it("loads npm packages from the packages map", async () => {
		const fake = toModuleURL(`export default (s) => s.toUpperCase(); export const size = 3;`);
		const r = await compile({ src: `\${ import up, { size } from "fake-pkg"; }\$[p]\${ up("x") }\$\${ size }\$[end]`, packages: { "fake-pkg": fake } });
		expect(text(r.tree)).toBe("<p>X3</p>");
	});

	it("returns runtime markers and unknown-tag warnings", async () => {
		const r = await compile({ src: `runtime \${ const n = 1; }\$\n[dvi]runtime \${ n }\$[end]` });
		expect(r.tree.children.some((n) => n.type === "runtime" && n.kind === "block")).toBe(true);
		expect(r.warnings[0]).toMatchObject({ source: "/anonymous.arcm", position: { line: 1, character: 0 } });
		expect(r.warnings[0].message).toMatch(/\[dvi\] is not an HTML element .*did you mean \[div\]/);
		const u = await compile({ src: `\${ const x = undefined; }\$[p]\${ x }\$[end]` });
		expect(u.warnings.map((w) => w.message)).toEqual([expect.stringMatching(/\$\{ x \}\$ is undefined/)]);
	});

	it.each([
		[{ src: `\${ import x from "left-pad"; }\$` }, /"left-pad" is not in packages; add packages: \{ "left-pad": "https:\/\/esm\.sh\/left-pad" \}/],
		[{ src: `\${ import { exec } from "node:child_process"; }\$` }, /"node:child_process" is not available in the browser/],
		[{ src: `[import = X: "./missing.arcm" !]` }, /can't read "\.\/missing\.arcm".*no baseUrl is set/],
		[{ src: `[p]\${ nope() }\$[end]` }, /anonymous\.arcm:1:7 {2}ReferenceError: nope is not defined/]
	])("rejects %o", async (request, message) => {
		await expect(compile(request)).rejects.toThrow(message);
	});
});

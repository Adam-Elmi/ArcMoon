// ###################
// CLI tests: run the real arcmoon command in a temp project
// ###################

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

const CLI = fileURLToPath(new URL("../cli/cli.mjs", import.meta.url));
const exec = promisify(execFile);

let dir;
let site;

// ###################
// Run arcmoon; never throws, returns code and output. Plain text: no colors, even in CI
// (picocolors turns them on when a CI variable is set)
// ###################
const PLAIN = { ...process.env, NO_COLOR: "1" };
delete PLAIN.FORCE_COLOR;

const arcmoon = async (...args) => {
	try {
		const { stdout, stderr } = await exec("node", [CLI, ...args], { cwd: site, env: PLAIN });
		return { code: 0, stdout, stderr };
	} catch (err) {
		return { code: err.code, stdout: err.stdout, stderr: err.stderr };
	}
};

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-cli-"));
	site = join(dir, "site");
	await mkdir(join(site, "src/components"), { recursive: true });
	await mkdir(join(site, "pages"), { recursive: true });
	await mkdir(join(dir, "theme"), { recursive: true });
	await writeFile(join(site, "src/components/Card.arcm"), `\${ const { title } = ArcMoon.props(); }\$\n[div = class: "card"][h2]\${ title }\$[end][slot!][end]`);
	await writeFile(join(site, "pages/index.arcm"), `[import = Card: "@/components/Card.arcm" !]\n[main][Card = title: "Home"]Hi[end:Card][end:main]`);
	await writeFile(join(site, "pages/themed.arcm"), `[import = Hero: "../../theme/Hero.arcm" !]\n[Hero!]`);
	await writeFile(join(dir, "theme/Hero.arcm"), `\${ const key = process.env.SECRET_KEY; }\$\n[section]hero[end]`);
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("cli", () => {
	it("prints the header, version and help", async () => {
		expect((await arcmoon()).stdout).toContain(`ArcMoon-${pkg.version}`);
		expect((await arcmoon("-v")).stdout.trim()).toBe(pkg.version);
		expect((await arcmoon("--help")).stdout).toContain("Usage: arcmoon <command>");
	});

	it("rejects unknown commands", async () => {
		const r = await arcmoon("frobnicate");
		expect(r.code).toBe(1);
		expect(r.stdout).toContain("Unrecognized option 'frobnicate'");
	});

	it("init creates the config once", async () => {
		expect((await arcmoon("init")).stdout).toContain("✓ Created");
		expect((await arcmoon("init")).stdout).toContain("Config already exists");
		expect(await readFile(join(site, "arcmoon.config.js"), "utf8")).toContain(`outDir: "./dist"`);
	});

	it("show reads the config from the current folder only", async () => {
		expect((await arcmoon("show", "--path-config")).stdout).toContain("no arcmoon.config.js");
		await arcmoon("init");
		const r = await arcmoon("show", "config");
		expect(JSON.parse(r.stdout)).toMatchObject({ importAliases: { "@": "./src" }, outDir: "./dist" });
	});

	it("warns when the config exports nothing", async () => {
		await writeFile(join(site, "arcmoon.config.js"), "");
		const r = await arcmoon("show", "config");
		expect(r.stderr).toContain("arcmoon.config.js exports nothing; using the default settings");
		expect(JSON.parse(r.stdout)).toEqual({});
	});

	it("build -p prints HTML using the config aliases", async () => {
		await arcmoon("init");
		const r = await arcmoon("build", "pages/index.arcm", "-p");
		expect(r.stdout.replace(/\s*\n\s*/g, "")).toBe(`<main><div class="card"><h2>Home</h2>Hi</div></main>`);
	});

	it("build puts JS inside the HTML by default, or in separate files with externalScripts", async () => {
		await writeFile(join(site, "pages/live.arcm"), `runtime \${ const n = 1; }\$\n[p]runtime \${ n }\$[end]`);
		await arcmoon("build", "pages/live.arcm", "-o", "inline");
		expect(await readFile(join(site, "inline/live.html"), "utf8")).toContain(`<script type="module">`);
		expect(await readdir(join(site, "inline"))).toEqual(["live.html"]);

		await writeFile(join(site, "arcmoon.config.js"), `export default { externalScripts: true };`);
		const r = await arcmoon("build", "pages/live.arcm", "-o", "out");
		expect(r.stdout).toMatch(/js out\/assets\/live-[A-Z0-9]+\.js/);
		expect(await readFile(join(site, "out/live.html"), "utf8")).toMatch(/<script type="module" src="\.\/assets\/live-[A-Z0-9]+\.js"><\/script>/);
	});

	it("build bundles CSS: [link] files, npm @import, url() files; inline or externalStyles", async () => {
		await mkdir(join(site, "styles"), { recursive: true });
		await mkdir(join(site, "node_modules/reset-css"), { recursive: true });
		await writeFile(join(site, "node_modules/reset-css/package.json"), `{ "name": "reset-css", "style": "reset.css" }`);
		await writeFile(join(site, "node_modules/reset-css/reset.css"), `* { margin: 0 }`);
		await writeFile(join(site, "styles/base.css"), `@import "reset-css";\nbody { background: url("./logo.png"); }`);
		await writeFile(join(site, "styles/logo.png"), "png");
		await writeFile(join(site, "pages/styled.arcm"), `[html][head][link = rel: "stylesheet", href: "../styles/base.css" !][end][body][style]p { color: red }[end][p]x[end][end][end]`);

		const first = await arcmoon("build", "pages/styled.arcm", "-o", "inline");
		expect(first.stderr).toBe("");
		const html = await readFile(join(site, "inline/styled.html"), "utf8");
		expect(html).toMatch(/<head><style>\*\{margin:0\}body\{background:url\("\.\/assets\/logo-[A-Z0-9]+\.png"\)\}p\{color:red\}<\/style><\/head><body><p>x<\/p>/);
		expect((await readdir(join(site, "inline/assets")))[0]).toMatch(/^logo-[A-Z0-9]+\.png$/);

		await writeFile(join(site, "arcmoon.config.js"), `export default { externalStyles: true };`);
		const r = await arcmoon("build", "pages/styled.arcm", "-o", "out");
		expect(r.stdout).toMatch(/css out\/assets\/styled-[A-Z0-9]+\.css/);
		const page = await readFile(join(site, "out/styled.html"), "utf8");
		const href = /<link rel="stylesheet" href="\.\/(assets\/styled-[A-Z0-9]+\.css)">/.exec(page)[1];
		expect(await readFile(join(site, "out", href), "utf8")).toMatch(/background:url\("\.\/logo-[A-Z0-9]+\.png"\)/);
	});

	it("build reports a missing stylesheet at the [link]", async () => {
		await writeFile(join(site, "pages/bad.arcm"), `[p]x[end]\n[link = rel: "stylesheet", href: "./nope.css" !]`);
		const r = await arcmoon("build", "pages/bad.arcm");
		expect(r.code).toBe(1);
		expect(r.stderr).toContain(`✗ can't find stylesheet "./nope.css"`);
		expect(r.stderr).toContain("bad.arcm:2:1");
	});

	it("build writes files to -o", async () => {
		await arcmoon("init");
		const r = await arcmoon("build", "pages/index.arcm", "-o", "out");
		expect(r.stdout).toContain("✓ pages/index.arcm → out/index.html");
		expect(await readdir(join(site, "out"))).toEqual(["index.html"]);
	});

	it("build stops at an untrusted template, then works after trust", async () => {
		await arcmoon("init");
		const blocked = await arcmoon("build", "pages");
		expect(blocked.code).toBe(1);
		expect(blocked.stderr).toMatch(/^⚠ Template "\.\.\/theme" is not trusted/);
		expect(blocked.stderr).toContain("SECRET_KEY");

		const audit = await arcmoon("audit", "pages/themed.arcm");
		expect(audit.stdout).toContain(`Template "../theme" (⚠ not trusted)`);

		expect((await arcmoon("trust", "pages/themed.arcm")).stdout).toContain(`✓ Trusted "../theme"`);
		expect((await arcmoon("trust", "--list")).stdout).toContain("../theme");
		expect((await arcmoon("audit", "pages/themed.arcm")).stdout).toContain(`Template "../theme" (✓ trusted)`);

		const built = await arcmoon("build", "pages");
		expect(built.code).toBe(0);
		expect((await readdir(join(site, "dist"))).sort()).toEqual(["index.html", "themed.html"]);

		expect((await arcmoon("untrust", "../theme")).stdout).toContain(`✓ Untrusted "../theme"`);
		expect((await arcmoon("build", "pages/themed.arcm")).code).toBe(1);
	});

	it("reports missing files and arguments", async () => {
		expect((await arcmoon("build", "nope.arcm")).stderr).toContain(`✗ "nope.arcm" is not found`);
		expect((await arcmoon("build", "pages/index.arcm", "-o")).stderr).toContain("✗ missing folder after -o");
	});

	it("prints tokens and the AST", async () => {
		expect(JSON.parse((await arcmoon("--lex", "pages/index.arcm")).stdout)[0].type).toBe("OPEN_BRACKET");
		expect(JSON.parse((await arcmoon("--parse", "pages/index.arcm")).stdout)[0]).toMatchObject({ type: "Import", name: "Card" });
	});
});

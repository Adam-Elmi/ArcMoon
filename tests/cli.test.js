// ###################
// CLI tests: run the real arcmoon command in a temp project
// ###################

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile, spawn } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runRepl } from "../cli/commands/repl.js";
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
		expect(r.stdout).toMatch(/js out[\\/]assets[\\/]live-[A-Z0-9]+\.js/);
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
		expect((await readdir(join(site, "inline/assets"))).filter((f) => !f.startsWith("."))).toEqual([expect.stringMatching(/^logo-[A-Z0-9]+\.png$/)]);

		await writeFile(join(site, "arcmoon.config.js"), `export default { externalStyles: true };`);
		const r = await arcmoon("build", "pages/styled.arcm", "-o", "out");
		expect(r.stdout).toMatch(/css out[\\/]assets[\\/]styled-[A-Z0-9]+\.css/);
		const page = await readFile(join(site, "out/styled.html"), "utf8");
		const href = /<link rel="stylesheet" href="\.\/(assets\/styled-[A-Z0-9]+\.css)">/.exec(page)[1];
		expect(await readFile(join(site, "out", href), "utf8")).toMatch(/background:url\("\.\/logo-[A-Z0-9]+\.png"\)/);
	});

	it("build removes files older builds wrote, and only those", async () => {
		await writeFile(join(site, "arcmoon.config.js"), `export default { externalScripts: true, externalStyles: true };`);
		const page = (name, n) => writeFile(join(site, `pages/${name}.arcm`), `runtime \${ const n = ${n}; }\$\n[p]runtime \${ n }\$[end]\n[style]p { order: ${n} }[end]`);
		const assets = async () => (await readdir(join(site, "out/assets"))).filter((f) => !f.startsWith(".")).sort();
		await page("one", 1);
		await page("two", 2);
		await arcmoon("build", "pages/one.arcm", "-o", "out");
		await arcmoon("build", "pages/two.arcm", "-o", "out");
		await writeFile(join(site, "out/assets/mine-ABC123.js"), "mine");
		const before = await assets();
		expect(before).toHaveLength(5);

		await page("one", 3);
		const r = await arcmoon("build", "pages/one.arcm", "-o", "out");
		expect(r.stdout).toMatch(/removed 2 old files from out[\\/]assets/);
		const after = await assets();
		expect(after.filter((f) => f.startsWith("one-"))).toHaveLength(2);
		expect(after.filter((f) => !f.startsWith("one-"))).toEqual(before.filter((f) => !f.startsWith("one-")));

		const again = await arcmoon("build", "pages/one.arcm", "-o", "out");
		expect(again.stdout).not.toContain("removed");
		expect(await assets()).toEqual(after);
	}, 15000);

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
		expect(r.stdout).toMatch(/✓ pages\/index\.arcm → out[\\/]index\.html/);
		expect(await readdir(join(site, "out"))).toEqual(["index.html"]);
	});

	it("build stops at an untrusted template, then works after trust", async () => {
		await arcmoon("init");
		const blocked = await arcmoon("build", "pages");
		expect(blocked.code).toBe(1);
		expect(blocked.stderr).toMatch(/^⚠ Template "\.\.\/theme" \(.*theme\) is not trusted/);
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
	}, 15000);

	it("reports missing files and arguments", async () => {
		expect((await arcmoon("build", "nope.arcm")).stderr).toContain(`✗ "nope.arcm" is not found`);
		expect((await arcmoon("build", "pages/index.arcm", "-o")).stderr).toContain("✗ missing folder after -o");
	});

	it("prints tokens and the AST", async () => {
		expect(JSON.parse((await arcmoon("--lex", "pages/index.arcm")).stdout)[0].type).toBe("OPEN_BRACKET");
		expect(JSON.parse((await arcmoon("--parse", "pages/index.arcm")).stdout)[0]).toMatchObject({ type: "Import", name: "Card" });
	});

	it("repl evaluates templates, multiline code, variables and dot commands", async () => {
		const arcmoonRepl = (input) =>
			new Promise((resolve) => {
				const child = spawn("node", [CLI, "repl"], { cwd: site, env: PLAIN });
				let stdout = "";
				let stderr = "";
				child.stdout.on("data", (d) => {
					stdout += d;
				});
				child.stderr.on("data", (d) => {
					stderr += d;
				});
				child.on("close", (code) => {
					resolve({ code, stdout, stderr });
				});
				child.stdin.write(input);
				child.stdin.end();
			});

		// 1. Single line evaluation
		const r1 = await arcmoonRepl("[h1]Hello REPL[end]\n.exit\n");
		expect(r1.code).toBe(0);
		expect(r1.stdout).toContain("<h1>Hello REPL</h1>");

		// 2. Multiline block evaluation
		const r2 = await arcmoonRepl("[div]\n  [p]Multiline text[end]\n[end]\n.exit\n");
		expect(r2.code).toBe(0);
		expect(r2.stdout).toContain("<div>\n  <p>Multiline text</p>\n</div>");

		// 3. Variable persistence across lines
		const r3 = await arcmoonRepl('${ const name = "ArcMoon"; }$\n[h1]Hello ${ name }$[end]\n.exit\n');
		expect(r3.code).toBe(0);
		expect(r3.stdout).toContain("<h1>Hello ArcMoon</h1>");

		// 4. Dot commands: .help, .ast, .lex, .show, .clear, .load
		const r4 = await arcmoonRepl(".help\n.exit\n");
		expect(r4.stdout).toContain(".ast");
		expect(r4.stdout).toContain(".lex");
		expect(r4.stdout).toContain(".load");
		expect(r4.stdout).toContain(".show");

		const r5 = await arcmoonRepl(".ast [p]Hi[end]\n.lex [p]Hi[end]\n.exit\n");
		expect(r5.stdout).toContain(`"type": "Block"`);
		expect(r5.stdout).toContain(`"type": "OPEN_BRACKET"`);

		await writeFile(join(site, "test-load.arcm"), "[section]Loaded section[end]");
		const r6 = await arcmoonRepl(".load test-load.arcm\n.exit\n");
		expect(r6.stdout).toContain("<section>Loaded section</section>");
		expect(r6.stdout).toContain("✓ Loaded test-load.arcm");

		// 5. Error recovery: syntax error does not crash the REPL session
		const r7 = await arcmoonRepl("[div][p][end:div]\n[p]Recovered[end]\n.exit\n");
		expect(r7.code).toBe(0);
		expect(r7.stdout).toContain("does not match");
		expect(r7.stdout).toContain("<p>Recovered</p>");
	}, 20000);

	it("editor mode allows navigating and editing previous lines", async () => {
		const inStream = new PassThrough();
		let out = "";
		const outStream = new Writable({
			write(c, enc, cb) {
				out += c.toString();
				cb();
			}
		});

		const server = await runRepl({
			input: inStream,
			output: outStream,
			terminal: true,
			banner: false
		});

		server.commands.editor.action.call(server);

		// Type line 1
		server._ttyWrite("[div]", { name: "undefined" });
		server._ttyWrite("\r", { name: "return" });
		// Type line 2
		server._ttyWrite("[end]", { name: "undefined" });
		// Navigate UP to line 1
		server._ttyWrite(undefined, { name: "up" });
		// Enter newline between [div] and [end]
		server._ttyWrite("\r", { name: "return" });
		// Type [p]In editor[end] on inserted line
		server._ttyWrite("[p]In editor[end]", { name: "undefined" });
		// Finish with Ctrl+D
		server._ttyWrite("\x04", { ctrl: true, name: "d" });

		await new Promise((resolve) => setTimeout(resolve, 800));
		server.close();

		expect(out).toContain("<div>\n<p>In editor</p>\n</div>");
	});
});

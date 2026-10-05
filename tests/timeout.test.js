// ###################
// D1: the build timeout stops ${ }$ code (it runs in a worker thread)
// ###################

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ArcMoon from "../node/compiler.js";

let dir;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-timeout-"));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

const compile = (src, options = {}) => new ArcMoon({ src, cwd: dir, onWarning() {}, ...options }).compile();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("build timeout", () => {
	it("stops an endless loop, and says where", async () => {
		const started = Date.now();
		await expect(compile(`[p]\${ while (true) {} }\$[end]`, { timeout: 500 })).rejects.toThrow(/anonymous\.arcm {2}\$\{ \}\$ code took longer than 500 ms and was stopped/);
		expect(Date.now() - started).toBeLessThan(3000);
	});

	it("names the component that was running", async () => {
		await mkdir(join(dir, "c"), { recursive: true });
		await writeFile(join(dir, "c/Slow.arcm"), `[p]\${ while (true) {} }\$[end]`);
		await expect(compile(`[import = Slow: "./c/Slow.arcm" !][Slow!]`, { timeout: 1500 })).rejects.toThrow(/Slow\.arcm {2}\$\{ \}\$ code took longer than 1500 ms/);
	});

	it("stops timers that are still running", async () => {
		const log = join(dir, "ticks.txt");
		await writeFile(log, "");
		const src = `\${ const { appendFileSync } = await import("node:fs"); setInterval(() => appendFileSync(${JSON.stringify(log)}, "x"), 20); await new Promise(() => {}); }\$`;
		await expect(compile(src, { timeout: 300 })).rejects.toThrow(/took longer than 300 ms and was stopped/);
		const after = (await readFile(log, "utf8")).length;
		await wait(200);
		expect((await readFile(log, "utf8")).length).toBe(after);
	});

	it("keeps working after a timeout", async () => {
		await expect(compile(`\${ while (true) {} }\$`, { timeout: 300 })).rejects.toThrow(/was stopped/);
		expect(await compile(`[p]\${ 1 + 1 }\$[end]`)).toBe("<p>2</p>");
	});

	it("survives process.exit() in ${ }$", async () => {
		await expect(compile(`\${ process.exit(1) }\$`)).rejects.toThrow(/ended the build worker/);
		expect(await compile(`[p]ok[end]`)).toBe("<p>ok</p>");
	});
});

describe("what crosses the worker", () => {
	it("still refuses functions as exported values, with the usual error", async () => {
		await expect(compile(`\${ export const f = () => 1; }\$[p]a[end]\nruntime \${ f(); }\$`)).rejects.toThrow(/"f" is a function; functions can't be sent to the browser/);
	});

	it("says when page props aren't plain data", async () => {
		await expect(compile(`[p]x[end]`, { props: { fn: () => 1 } })).rejects.toThrow(/page props must be plain data/);
	});
});

// ###################
// Build dist/ with esbuild
// ###################

import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// ###################
// Each entry point and where it runs
// ###################
const entries = [
	{ in: "node/compiler.js", out: "dist/node.js", platform: "node" },
	{ in: "node/eval-worker.js", out: "dist/eval-worker.js", platform: "node" },
	{ in: "core/index.js", out: "dist/core.js", platform: "neutral" },
	{ in: "runtime/reactive.js", out: "dist/reactive.js", platform: "browser" },
	{ in: "browser/worker.js", out: "dist/worker.js", platform: "browser", standalone: true },
	{ in: "browser/index.js", out: "dist/browser.js", platform: "browser", standalone: true, define: { __ARCM_DIST__: "true" } },
	// ###################
	// What browser compile() output imports by URL (next to browser.js)
	// ###################
	{ in: "runtime/client.js", out: "dist/runtime/client.js", platform: "browser", standalone: true },
	{ in: "runtime/reactive.js", out: "dist/runtime/reactive.js", platform: "browser", standalone: true }
];

for (const file of ["node.js", "eval-worker.js", "core.js", "reactive.js", "worker.js", "browser.js", "runtime/client.js", "runtime/reactive.js"]) {
	await rm(`${root}dist/${file}`, { force: true });
}

for (const entry of entries) {
	await build({
		absWorkingDir: root,
		entryPoints: [entry.in],
		outfile: entry.out,
		bundle: true,
		format: "esm",
		platform: entry.platform,
		packages: entry.standalone ? undefined : "external",
		minify: entry.standalone ?? false,
		define: entry.define,
		target: "es2022",
		logLevel: "info"
	});
}

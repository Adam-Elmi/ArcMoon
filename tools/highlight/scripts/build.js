// ###################
// Build dist/ with esbuild. ArcMoon's lexer and parser (../../core) are bundled in,
// so this package needs no arcmoon install and always matches the ArcMoon next to it
//   index.js, dynamic.js, diagnostics.js  ESM for npm (shared code in chunks/)
//   arcmoon-highlight.js                  CDN: static highlighting only
//   arcmoon-highlight.full.js             CDN: static + errors + the live editor (CodeMirror inside)
// ###################

import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(await readFile(`${root}package.json`, "utf8"));
const banner = { js: `/* arcmoon-highlight ${pkg.version} | MIT License | https://github.com/Adam-Elmi/ArcMoon */` };

await rm(`${root}dist`, { recursive: true, force: true });

// ###################
// npm: dependencies and CodeMirror stay imports (two CodeMirrors on one page break it)
// ###################
await build({
	absWorkingDir: root,
	entryPoints: { index: "index.js", dynamic: "src/dynamic.js", diagnostics: "src/diagnostics.js" },
	outdir: "dist",
	chunkNames: "chunks/[name]-[hash]",
	bundle: true,
	splitting: true,
	format: "esm",
	platform: "neutral",
	external: [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)],
	banner,
	logLevel: "info"
});

// ###################
// CDN: everything inside, global ArcMoonHighlight
// ###################
for (const [entry, out] of [["index.js", "arcmoon-highlight.js"], ["src/cdn.js", "arcmoon-highlight.full.js"]]) {
	await build({
		absWorkingDir: root,
		entryPoints: [entry],
		outfile: `dist/${out}`,
		bundle: true,
		format: "iife",
		globalName: "ArcMoonHighlight",
		platform: "browser",
		minify: true,
		banner,
		logLevel: "info"
	});
}

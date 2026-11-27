#!/usr/bin/env node

import path from "node:path";
import { buildIcons } from "./index.js";

const args = process.argv.slice(2);
const usage = `Arci — build ArcMoon icon components from installed SVG packages

Usage:
  arci build <npm-package> [--out DIR] [--alias NAME] [--svg-dir DIR]

Example:
  arci build lucide-static
`;

if (args.includes("-h") || args.includes("--help")) {
	console.log(usage);
	process.exit(0);
}

if (args[0] !== "build" || !args[1]) {
	console.error(usage);
	process.exit(2);
}

const options = { packageName: args[1] };
for (let i = 2; i < args.length; i++) {
	const [key, inline] = args[i].split("=", 2);
	const values = { "--out": "outDir", "--alias": "alias", "--svg-dir": "svgDir" };
	if (!(key in values)) {
		console.error(`Unknown option: ${key}\n\n${usage}`);
		process.exit(2);
	}
	const value = inline ?? args[++i];
	if (!value || value.startsWith("--")) {
		console.error(`Missing value for ${key}\n\n${usage}`);
		process.exit(2);
	}
	options[values[key]] = value;
}

try {
	const result = await buildIcons(options);
	console.log(`Built ${result.count} ArcMoon icon components from ${result.packageName} → ${path.relative(process.cwd(), result.targetRoot) || "."}`);
	console.log(`\nAdd this alias to arcmoon.config.js:\n\n  importAliases: {\n    "${result.alias}": "./${path.relative(process.cwd(), result.outputRoot).split(path.sep).join("/")}"\n  }`);
	if (result.first) {
		console.log(`\nExample import:\n\n  [import = ${result.first.name}: "${result.first.importPath}" !]`);
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}

#!/usr/bin/env node

import path from "node:path";
import { migrateHtmlDirectory } from "./index.js";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
console.log(`ArcMigrate — HTML to ArcMoon

Usage:
  arcmigrate <html-project-dir> <output-dir>

Converts .html and .htm files to .arcm and copies all other files unchanged.
`);
	process.exit(0);
}

if (args.length !== 2) {
	console.error("Usage: arcmigrate <html-project-dir> <output-dir>");
	process.exit(2);
}

try {
	const result = await migrateHtmlDirectory(path.resolve(args[0]), path.resolve(args[1]), {
		onWarning: (message) => console.warn(`Warning: ${message}`)
	});
	console.log(`Converted ${result.converted} HTML file${result.converted === 1 ? "" : "s"}; copied ${result.copied} other file${result.copied === 1 ? "" : "s"} to ${result.output}`);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}

// ###################
// Compile one file with the project config
// ###################

import path from "node:path";
import ArcMoon, { loadGraph, buildPages } from "../../node/compiler.js";
import { reportWarning } from "./report.js";

const options = (filename, config, dev = false, cwd = process.cwd()) => ({
	filename: path.resolve(filename),
	importAliases: config.importAliases ?? {},
	removeComments: config.removeComments ?? true,
	timeout: config.timeout ?? 5000,
	bundle: config.bundle ?? [],
	packages: config.packages ?? {},
	cwd,
	dev,
	onWarning: reportWarning
});

export const compile = (filename, config, dev, cwd) => new ArcMoon(options(filename, config, dev, cwd)).compile();
export const graph = (filename, config) => loadGraph(options(filename, config));

// ###################
// Many files at once: JS / CSS inside each page, or separate files
// ###################
export const build = (filenames, config, outDir, dev) =>
	buildPages(filenames.map((f) => options(f, config, dev)), {
		cwd: process.cwd(),
		outDir,
		siteDir: config.outDir ?? "./dist",
		assetsDir: config.assetsDir ?? "assets",
		base: config.base,
		bundle: config.bundle ?? [],
		packages: config.packages ?? {},
		externalScripts: config.externalScripts ?? false,
		externalStyles: config.externalStyles ?? false,
		dev,
		onWarning: reportWarning
	});

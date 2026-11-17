// ###################
// File helpers
// ###################

import fs from "node:fs/promises";
import path from "node:path";
import { EXTENSION } from "../constants.js";

export const isExist = async (p) => {
	if (!p) return false;
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
};

export const isDirectory = async (p) => {
	try {
		return (await fs.stat(p)).isDirectory();
	} catch {
		return false;
	}
};

export const createFile = async (folder, file, content) => {
	await fs.mkdir(folder, { recursive: true });
	await fs.writeFile(path.join(folder, file), content);
};

const findArcmRecursive = async (dir) => {
	const found = [];
	const walk = async (d) => {
		let entries;
		try {
			entries = await fs.readdir(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith(".")) continue;
			if (e.name === "node_modules" && !dir.split(path.sep).includes("node_modules")) continue;
			const full = path.join(d, e.name);
			if (e.isDirectory()) {
				await walk(full);
			} else if (e.isFile() && e.name.endsWith(EXTENSION)) {
				found.push(full);
			}
		}
	};
	await walk(dir);
	return found.sort();
};

// ###################
// A .arcm file, or the .arcm files inside a folder (or node_modules package)
// ###################
export const arcmFiles = async (target, { recursive = false, checkNodeModules = false } = {}) => {
	let resolved = target;
	if (checkNodeModules && !(await isExist(target))) {
		const nm = path.join(process.cwd(), "node_modules", target);
		if (await isExist(nm)) resolved = nm;
	}
	if (!(await isExist(resolved))) throw new Error(`"${target}" is not found`);
	if (await isDirectory(resolved)) {
		let names = [];
		if (recursive) {
			names = await findArcmRecursive(resolved);
		} else {
			names = (await fs.readdir(resolved)).filter((n) => n.endsWith(EXTENSION)).map((n) => path.join(resolved, n)).sort();
		}
		if (!names.length) throw new Error(`no ${EXTENSION} files in "${target}"`);
		return names;
	}
	if (!resolved.endsWith(EXTENSION)) throw new Error(`only ${EXTENSION} files are accepted, got "${target}"`);
	return [resolved];
};

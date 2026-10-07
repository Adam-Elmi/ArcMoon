// ###################
// Remove files older builds wrote to assetsDir and nothing uses any more
// Only files listed in .arcmoon-files.json (written by ArcMoon) are ever removed
// ###################

import fs from "node:fs/promises";
import path from "node:path";

export const LIST = ".arcmoon-files.json";

const readText = (file) => fs.readFile(file, "utf8").catch(() => "");

const readList = async (assets) => {
	try {
		const list = JSON.parse(await fs.readFile(path.join(assets, LIST), "utf8"));
		return Array.isArray(list.files) ? list.files.filter((f) => typeof f === "string" && !f.includes("..")) : [];
	} catch {
		return [];
	}
};

// ###################
// A file is used when a page in outDir names it, or a used JS / CSS file does
// (names carry a hash, so finding the name in the text is enough)
// ###################
const usedFiles = async (outDir, assets, files) => {
	const pages = (await fs.readdir(outDir, { recursive: true }).catch(() => []))
		.filter((f) => f.endsWith(".html"))
		.map((f) => path.join(outDir, f));
	const used = new Set();
	const queue = [...pages];
	while (queue.length) {
		const text = await readText(queue.shift());
		for (const file of files) {
			if (used.has(file) || !text.includes(path.basename(file))) continue;
			used.add(file);
			if (/\.(js|css)$/.test(file)) queue.push(path.join(assets, file));
		}
	}
	return used;
};

export async function cleanAssets(outDir, assetsDir, written) {
	const assets = path.resolve(outDir, assetsDir);
	const fresh = written.map((f) => path.relative(assets, f)).filter((f) => !f.startsWith(".."));
	const files = [...new Set([...(await readList(assets)), ...fresh].map((f) => f.split(path.sep).join("/")))];
	if (!files.length) return [];

	const used = await usedFiles(path.resolve(outDir), assets, files);
	const removed = [];
	for (const file of files) {
		if (used.has(file)) continue;
		const full = path.join(assets, file);
		if (await fs.rm(full).then(() => true, () => false)) removed.push(full);
		if (path.dirname(full) !== assets) await fs.rmdir(path.dirname(full)).catch(() => {});
	}

	const kept = files.filter((f) => used.has(f));
	if (kept.length) await fs.writeFile(path.join(assets, LIST), JSON.stringify({ files: kept }, null, "\t") + "\n");
	else await fs.rm(path.join(assets, LIST), { force: true });
	return removed;
}

// ###################
// trust / trust --list / untrust
// ###################

import { arcmFiles } from "../helpers/file.js";
import { loadConfig } from "../helpers/config.js";
import { graph } from "../helpers/compile.js";
import { cliError } from "../helpers/errors.js";
import { success, rows, dim } from "../helpers/report.js";
import { trust, untrust, readTrust, formatReport } from "../../node/protector.js";

export async function runTrust(target) {
	if (!target) cliError("missing file or folder: arcmoon trust <file|dir>");
	if (target === "--list") return listTrusted();
	try {
		const config = await loadConfig();
		let count = 0;
		const trustedKeys = new Set();
		for (const file of await arcmFiles(target, { recursive: true, checkNodeModules: true })) {
			for (const t of await trust(await graph(file, config), { root: process.cwd() })) {
				if (trustedKeys.has(t.key)) continue;
				trustedKeys.add(t.key);
				success(`Trusted "${t.key}" ${dim(`(${t.hash.slice(0, 19)}…)`)}\n${rows(formatReport(t))}`);
				count++;
			}
		}
		if (!count) console.log("No templates to trust; these files only use your own files.");
		else console.log(dim("\nSaved to arcmoon.trust.json. If a template changes, ArcMoon asks again."));
	} catch (err) {
		cliError(err);
	}
}

async function listTrusted() {
	const templates = Object.entries((await readTrust(process.cwd())).templates ?? {});
	if (!templates.length) return console.log("No trusted templates.");
	for (const [key, t] of templates) {
		const packages = Object.entries(t.packages ?? {}).map(([n, v]) => `${n}@${v}`).join(", ");
		console.log(`${key}  (trusted ${t.trustedAt})${packages ? `  ${packages}` : ""}`);
	}
}

export async function runUntrust(keys) {
	if (!keys.length) cliError("missing template: arcmoon untrust <template...>");
	const removed = await untrust(keys, { root: process.cwd() });
	for (const k of keys) removed.includes(k) ? success(`Untrusted "${k}"`) : console.log(`"${k}" was not trusted`);
}

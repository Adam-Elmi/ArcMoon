// ###################
// audit: show what templates do, run nothing
// ###################

import path from "node:path";
import { arcmFiles } from "../helpers/file.js";
import { loadConfig } from "../helpers/config.js";
import { graph } from "../helpers/compile.js";
import { cliError } from "../helpers/errors.js";
import { rows } from "../helpers/report.js";
import pc from "picocolors";
import { analyze, readTrust, formatReport } from "../../node/protector.js";

export async function runAudit(target) {
	if (!target) cliError("missing file or folder: arcmoon audit <file|dir>");
	try {
		const config = await loadConfig();
		const trusted = (await readTrust(process.cwd())).templates ?? {};
		for (const file of await arcmFiles(target, { recursive: true, checkNodeModules: true })) {
			const result = await analyze(await graph(file, config), { root: process.cwd() });
			console.log(`\n${pc.bold(file)}`);
			if (result.own) console.log(`  Your files (${result.own.files.length}):\n${rows(formatReport(result.own))}`);
			for (const t of result.templates) {
				const state = trusted[t.key]?.hash === t.hash ? pc.green("✓ trusted") : pc.yellow(trusted[t.key] ? "⚠ changed since trusted" : "⚠ not trusted");
				console.log(`\n  Template "${t.key}" (${state}):\n${rows(formatReport(t))}`);
			}
			if (!result.templates.length) console.log(`\n  No templates from outside ${path.basename(process.cwd())}.`);
		}
	} catch (err) {
		cliError(err);
	}
}

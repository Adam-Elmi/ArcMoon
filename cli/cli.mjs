#!/usr/bin/env node
// ###################
// ArcMoon CLI: read the arguments and run the right command
// ###################

import { getHelp } from "./commands/help.js";
import { printVersion, printHeader } from "./commands/version.js";
import { runInit } from "./commands/init.js";
import { runShow } from "./commands/show.js";
import { runBuild } from "./commands/build.js";
import { printLex, printParse } from "./commands/print.js";
import { runAudit } from "./commands/audit.js";
import { runTrust, runUntrust } from "./commands/trust.js";
import { runRepl } from "./commands/repl.js";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
	if (args.length === 0) return printHeader();
	if (command === "-h" || command === "--help") return getHelp(false);
	if (command === "-v" || command === "--version") return printVersion();
	if (command === "init") return runInit();
	if (command === "show") return runShow(args[1]);
	if (command === "build") return runBuild(args.slice(1));
	if (command === "--lex") return printLex(args[1]);
	if (command === "--parse") return printParse(args[1]);
	if (command === "audit") return runAudit(args[1]);
	if (command === "trust") return runTrust(args[1]);
	if (command === "untrust") return runUntrust(args.slice(1));
	if (command === "repl") return runRepl();
	getHelp();
	process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

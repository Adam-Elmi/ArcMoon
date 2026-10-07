// ###################
// Help message
// ###################

import { options } from "../constants.js";

export function getHelp(unknownOption = true) {
	const arg = process.argv[2];
	const lines = [
		unknownOption && arg && !options.includes(arg) ? `Unrecognized option '${arg}'\n` : "",
		"Usage: arcmoon <command> [options]",
		"",
		"Global:",
		"  -h, --help                    Show this help",
		"  -v, --version                 Show the version",
		"  init                          Create arcmoon.config.js here",
		"  show config                   Show the loaded config",
		"  show --path-config            Show the path of the loaded config",
		"",
		"Build:",
		"  build <file|dir>              Compile .arcm to .html (into outDir)",
		"  build <file|dir> -o <dir>     Compile into <dir>",
		"  build <file> -p               Print the HTML instead of writing it",
		"  build <file|dir> --dev        Readable JS with source maps (for debugging)",
		"  --lex <file>                  Print lexer tokens",
		"  --parse <file>                Print the AST",
		"",
		"Protector:",
		"  audit <file|dir>              Show what each template does, run nothing",
		"  trust <file|dir>              Trust the templates used by these files",
		"  trust --list                  List trusted templates",
		"  untrust <template...>         Remove templates from arcmoon.trust.json",
		"",
		"Examples:",
		"  arcmoon build page.arcm",
		"  arcmoon build src/pages -o dist",
		"  arcmoon audit page.arcm"
	];
	console.log(lines.filter((l, i) => i > 0 || l).join("\n"));
}

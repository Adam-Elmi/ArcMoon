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
		"  repl                          Start an interactive ArcMoon REPL",
		"  dev [dir] [key=value...]       Serve pages from <dir> on demand with live reload",
		"    --port <number>              Port to listen on (default: 3000)",
		"    --host <address>             Host to bind (default: 127.0.0.1)",
		"    port=<number> host=<address> Key=value forms of the same options",
		"    host=true / --host=true      Bind to all IPv4 interfaces (LAN access)",
		"  Dev uses config from the current folder; run build before deploying",
		"  Restart dev after npm install; file changes reload every open page",
		"  LAN: host=true exposes project files to your network; allow the port in your firewall",
		"    Windows: allow Node.js on Private networks; Linux UFW: sudo ufw allow <port>/tcp",
		"    Use the same Wi-Fi; guest networks/AP isolation can block device access",
		"    WSL2 may need port forwarding or mirrored networking for LAN access",
		"    LAN HTTP is not a secure context; browser APIs requiring HTTPS may be unavailable",
		"    arcmoon/utils copyText has an HTTP fallback for clipboard copying",
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
		"  arcmoon dev pages --port 3000",
		"  arcmoon dev pages port=4000 host=localhost",
		"  arcmoon dev pages port=4000 host=true",
		"  arcmoon audit page.arcm"
	];
	console.log(lines.filter((l, i) => i > 0 || l).join("\n"));
}

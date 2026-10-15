// ###################
// node: modules in the browser: polyfills and virtual node:fs
// ###################

import * as pathe from "pathe";
import * as events from "events";
import { Buffer } from "buffer";

// ###################
// Paths in node:fs are read from the virtual root
// ###################
const fsFor = (host) => {
	const at = (path) => pathe.resolve("/", String(path));
	const out = (text, encoding) => (encoding ? text : Buffer.from(text));
	const enc = (options) => (typeof options === "string" ? options : options?.encoding);

	const promises = {
		readFile: async (path, options) => out(await host.readFile(at(path)), enc(options)),
		access: async (path) => {
			await host.readFile(at(path));
		}
	};
	return {
		promises,
		readFileSync: (path, options) => out(host.readFileSync(at(path)), enc(options)),
		existsSync: (path) => host.exists(at(path))
	};
};

// ###################
// Put the modules where generated code can reach them
// ###################
const OURS = Symbol("arcmoon process");

export function installNode(host, env = {}) {
	const fs = fsFor(host);
	globalThis.__arcmNode = {
		path: { ...pathe, default: pathe },
		events: { ...events, default: events.default ?? events },
		buffer: { Buffer, default: { Buffer } },
		url: {
			URL,
			URLSearchParams,
			fileURLToPath: (u) => new URL(u).pathname,
			pathToFileURL: (p) => new URL(`file://${p}`),
			default: { URL, URLSearchParams }
		},
		fs: { ...fs, default: fs },
		"fs/promises": { ...fs.promises, default: fs.promises }
	};
	// ###################
	// process.env only has the values passed in, set fresh for each compile so one page's
	// env never leaks into the next; Node's real process (tests) is left alone
	// ###################
	if (typeof globalThis.process === "undefined") globalThis.process = { env: {}, [OURS]: true };
	if (globalThis.process[OURS]) globalThis.process.env = { ...env };
}

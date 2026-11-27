// ###################
// dev: compile pages on request and serve the project with live reload
// ###################

import path from "node:path";
import os from "node:os";
import { loadConfig } from "../helpers/config.js";
import { createDevServer } from "../helpers/devserver.js";
import { cliError } from "../helpers/errors.js";

// ###################
// Resolve host=true/false while preserving literal addresses and hostnames
// ###################
export function resolveHost(value) {
	if (value === undefined || value === null || value === false || value === "" || value === "false") return "127.0.0.1";
	if (value === true || value === "true") return "0.0.0.0";
	return value;
}

// ###################
// LAN IPv4 URLs, with private ranges listed before public interfaces
// ###################
export function networkUrls(interfaces, port) {
	const addresses = Object.values(interfaces ?? {}).flatMap((entries) => entries ?? []).filter((entry) => entry.family === "IPv4" && !entry.internal);
	const rank = (address) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) ? 0 : 1;
	return addresses.sort((a, b) => rank(a.address) - rank(b.address)).map((entry) => `http://${entry.address}:${port}`);
}

export function parseDevArgs(args, cwd = process.cwd()) {
	let pagesDir = cwd;
	let host;
	let port = 3000;
	let hasPagesDir = false;
	const parseHost = (value) => value === "true" ? true : value === "false" ? false : value;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--host") host = parseHost(args[++i]);
		else if (args[i].startsWith("--host=")) host = parseHost(args[i].slice("--host=".length));
		else if (args[i] === "--port") port = Number(args[++i]);
		else if (args[i].startsWith("--port=")) port = Number(args[i].slice("--port=".length));
		else if (args[i].includes("=")) {
			const at = args[i].indexOf("=");
			const key = args[i].slice(0, at);
			const value = args[i].slice(at + 1);
			if (key === "host") host = parseHost(value);
			else if (key === "port") port = Number(value);
			else throw new Error(`unknown dev option: ${key}`);
		}
		else if (!args[i].startsWith("-")) {
			if (hasPagesDir) throw new Error("pass only one pages directory to arcmoon dev");
			pagesDir = path.resolve(cwd, args[i]);
			hasPagesDir = true;
		}
		else throw new Error(`unknown dev option: ${args[i]}`);
	}
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be an integer between 1 and 65535");
	return { root: cwd, pagesDir, host, port };
}

export async function runDev(args) {
	let options;
	try { options = parseDevArgs(args); } catch (err) { cliError(err); }
	const { root, pagesDir, host, port } = options;
	const bindHost = resolveHost(host);
	try {
		const config = await loadConfig(root);
		const dev = createDevServer({ root, pagesDir, config, port, host: bindHost });
		const address = await dev.listen();
		const urlPort = address.port;
		const loopbackOnly = bindHost === "127.0.0.1" || bindHost === "localhost" || bindHost === "::1";
		if (bindHost === "0.0.0.0") console.warn("Visible to everyone on your network.");
		if (loopbackOnly || bindHost === "0.0.0.0") console.log(`  Local:   http://localhost:${urlPort}`);
		if (bindHost === "0.0.0.0") {
			for (const url of networkUrls(os.networkInterfaces(), urlPort)) console.log(`  Network: ${url}`);
		} else if (!loopbackOnly) {
			const shownHost = bindHost.includes(":") && !bindHost.startsWith("[") ? `[${bindHost}]` : bindHost;
			console.log(`  Network: http://${shownHost}:${urlPort}`);
		}
		const stop = async () => {
			process.off("SIGINT", onInt);
			process.off("SIGTERM", onTerm);
			await dev.close();
			process.exit(0);
		};
		const onInt = () => stop();
		const onTerm = () => stop();
		process.once("SIGINT", onInt);
		process.once("SIGTERM", onTerm);
		return dev;
	} catch (err) {
		if (err?.code === "EADDRINUSE") cliError(`port ${port} is already in use on ${host}`);
		cliError(err);
	}
}

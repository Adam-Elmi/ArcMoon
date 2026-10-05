// ###################
// A tiny static server for dist/: npm run serve, then open http://localhost:4400
// ###################

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(import.meta.dirname, "dist");
const PORT = Number(process.env.PORT ?? 4400);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

createServer(async (req, res) => {
	let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
	if (path === "" || path.endsWith("/")) path += "index.html";
	if (!extname(path)) path += ".html";
	const file = join(ROOT, path);
	if (!file.startsWith(ROOT)) return res.writeHead(403).end();
	try {
		const body = await readFile(file);
		res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
	} catch {
		res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
	}
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));

// ###################
// ArcMoon Web Worker: compiles away from the page's DOM, cookies and storage
// ###################

import { compileInWorker } from "./compile.js";

const toModuleURL = (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));

self.onmessage = async (event) => {
	const { id, request } = event.data;
	try {
		const result = await compileInWorker(request, { toModuleURL });
		self.postMessage({ id, ok: true, result });
	} catch (err) {
		self.postMessage({ id, ok: false, error: { name: err?.name ?? "Error", message: err?.message ?? String(err) } });
	}
};

// ###################
// Loaded: the page starts its timeouts from here, so a slow download isn't counted as ${ }$ time
// ###################
self.postMessage({ ready: true });

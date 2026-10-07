// ###################
// build: .arcm files to .html files, plus bundled JS / CSS files
// ###################

import path from "node:path";
import { arcmFiles, createFile } from "../helpers/file.js";
import { loadConfig } from "../helpers/config.js";
import { compile, build } from "../helpers/compile.js";
import { cleanAssets } from "../helpers/clean.js";
import { cliError } from "../helpers/errors.js";
import { success, size, dim } from "../helpers/report.js";

const bytes = (text) => Buffer.byteLength(text);

export async function runBuild(args) {
	const target = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-o");
	const print = args.includes("-p") || args.includes("--print");
	const dev = args.includes("--dev");
	const outIndex = args.indexOf("-o");
	if (!target) cliError("missing file or folder: arcmoon build <file|dir>");
	if (outIndex !== -1 && !args[outIndex + 1]) cliError("missing folder after -o");

	try {
		const config = await loadConfig();
		const files = await arcmFiles(target);
		if (print && files.length > 1) cliError("-p prints one file; pass a .arcm file, not a folder");
		const outDir = outIndex !== -1 ? args[outIndex + 1] : config.outDir ?? "./dist";
		const started = performance.now();

		// ###################
		// -p: print one page, JS and CSS inside
		// ###################
		if (print) {
			console.log(await compile(files[0], config, dev));
			return;
		}

		// ###################
		// HTML files; JS / CSS inside each page by default,
		// separate files with externalScripts / externalStyles; url() files copied
		// ###################
		const result = await build(files, config, outDir, dev);
		for (const [i, page] of result.pages.entries()) {
			await createFile(outDir, `${page.name}.html`, page.html);
			const script = /<script type="module">([\s\S]*?)<\/script>/.exec(page.html);
			const extra = script ? `  ${dim(`(script ${size(bytes(script[1]))})`)}` : "";
			success(`${files[i]} → ${path.join(outDir, `${page.name}.html`)}  ${size(bytes(page.html))}${extra}`);
		}
		for (const f of result.files) {
			await createFile(path.dirname(f.path), path.basename(f.path), f.contents);
			const kind = f.path.endsWith(".js") ? "js" : f.path.endsWith(".css") ? "css" : "file";
			console.log(`  ${dim(kind)} ${path.relative(process.cwd(), f.path)}  ${size(bytes(f.contents))}`);
		}
		const removed = await cleanAssets(outDir, config.assetsDir ?? "assets", result.files.map((f) => f.path));
		if (removed.length) console.log(`  ${dim("removed")} ${removed.length} old file${removed.length === 1 ? "" : "s"} from ${path.join(outDir, config.assetsDir ?? "assets")}`);
		console.log(dim(`  ${Math.round(performance.now() - started)} ms`));
	} catch (err) {
		cliError(err);
	}
}

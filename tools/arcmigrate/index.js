import { copyFile, lstat, mkdir, readFile, readdir, readlink, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "parse5";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const BOOLEAN = new Set(["allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected"]);

const quote = (value) => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const escapeText = (value) => String(value)
	.replaceAll("\\", "\\\\")
	.replaceAll("[", "\\[")
	.replaceAll("#", "\\#")
	.replaceAll("${", "\\${");

const escapeRaw = (value) => String(value).replaceAll("[", "\\[");

const rawHtml = (value) => `\${ ({ raw: ${JSON.stringify(value)} }) }$`;

const childNodes = (node) => node.content?.childNodes ?? node.childNodes ?? [];

const convertNode = (node) => {
	if (node.nodeName === "#text") return escapeText(node.value);
	if (node.nodeName === "#comment") return rawHtml(`<!--${node.data}-->`);
	if (node.nodeName === "#documentType") {
		if (node.name.toLowerCase() === "html" && !node.publicId && !node.systemId) return "[doctype!]";
		let value = `<!DOCTYPE ${node.name}`;
		if (node.publicId) value += ` PUBLIC ${quote(node.publicId)}`;
		if (node.systemId) value += `${node.publicId ? " " : " SYSTEM "}${quote(node.systemId)}`;
		return rawHtml(`${value}>`);
	}
	if (node.tagName) {
		const tag = node.tagName;
		const attrs = (node.attrs ?? []).map(({ name, value }) => {
			const val = BOOLEAN.has(name.toLowerCase()) && value === "" ? "true" : quote(value);
			return `${quote(name)}: ${val}`;
		});
		const raw = tag === "script" || tag === "style";
		if (raw) attrs.push('"arcm-raw": true');
		const header = `[${tag}${attrs.length ? ` = ${attrs.join(", ")}` : ""}${VOID.has(tag) ? " !" : ""}]`;
		if (VOID.has(tag)) return header;
		const body = childNodes(node).map((child) => raw && child.nodeName === "#text" ? escapeRaw(child.value) : convertNode(child)).join("");
		return `${header}${body}[end]`;
	}
	if (node.nodeName === "#document" || node.nodeName === "#document-fragment") return childNodes(node).map(convertNode).join("");
	throw new Error(`Unsupported HTML node: ${node.nodeName ?? "(unknown)"}`);
};

export function htmlToArcMoon(source, { onParseError = () => {} } = {}) {
	if (typeof source !== "string") throw new TypeError("htmlToArcMoon: source must be a string");
	const document = parse(source, { onParseError });
	return `${convertNode(document)}\n`;
}

const inside = (parent, child) => {
	const rel = path.relative(parent, child);
	return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
};

export async function migrateHtmlDirectory(inputDir, outputDir, { onWarning = () => {} } = {}) {
	const source = path.resolve(inputDir);
	const output = path.resolve(outputDir);
	const sourceStat = await lstat(source);
	if (!sourceStat.isDirectory()) throw new Error(`Input is not a directory: ${source}`);
	if (source === output || inside(source, output)) throw new Error("Output directory must be outside the input directory");

	let converted = 0;
	let copied = 0;
	const generated = new Set();
	const visit = async (dir) => {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const from = path.join(dir, entry.name);
			const rel = path.relative(source, from);
			const to = path.join(output, rel);
			if (entry.isDirectory()) {
				await mkdir(to, { recursive: true });
				await visit(from);
				continue;
			}
			if (entry.isSymbolicLink()) {
				await mkdir(path.dirname(to), { recursive: true });
				await symlink(await readlink(from), to);
				copied++;
				continue;
			}
			if (!entry.isFile()) continue;
			await mkdir(path.dirname(to), { recursive: true });
			if (/\.html?$/i.test(entry.name)) {
				const errors = [];
				const arcmoon = htmlToArcMoon(await readFile(from, "utf8"), { onParseError: (error) => errors.push(error) });
				const target = to.replace(/\.html?$/i, ".arcm");
				if (generated.has(target)) throw new Error(`Multiple HTML files map to the same ArcMoon file: ${target}`);
				generated.add(target);
				if (errors.length) onWarning(`${rel}: HTML parser recovered from ${errors.length} parse issue${errors.length === 1 ? "" : "s"}; the converted output may differ from the source`);
				await mkdir(path.dirname(target), { recursive: true });
				await writeFile(target, arcmoon);
				converted++;
			} else {
				await copyFile(from, to);
				copied++;
			}
		}
	};

	await mkdir(output, { recursive: true });
	await visit(source);
	return { converted, copied, output };
}

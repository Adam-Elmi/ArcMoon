import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SaxesParser } from "saxes";

const escapeText = (value) => String(value)
	.replaceAll("\\", "\\\\")
	.replaceAll("[", "\\[")
	.replaceAll("#", "\\#")
	.replaceAll("${", "\\${");

const escapeRaw = (value) => String(value).replaceAll("[", "\\[");
const quote = (value) => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const parseSvg = (source, filename) => {
	const document = { children: [] };
	const stack = [document];
	const parser = new SaxesParser({ fileName: filename });
	let parseError = null;
	parser.on("error", (error) => { parseError ??= error; });
	parser.on("doctype", () => { parseError ??= new Error("DOCTYPE declarations are not supported in icon SVGs"); });
	parser.on("processinginstruction", (instruction) => {
		if (instruction.target.toLowerCase() !== "xml") parseError ??= new Error(`Unsupported XML processing instruction: ${instruction.target}`);
	});
	parser.on("opentag", (tag) => {
		const node = {
			type: "element",
			name: tag.name,
			attributes: Object.entries(tag.attributes).map(([name, value]) => ({ name, value })),
			children: []
		};
		stack.at(-1).children.push(node);
		if (!tag.isSelfClosing) stack.push(node);
	});
	parser.on("closetag", (tag) => { if (!tag.isSelfClosing && stack.length > 1) stack.pop(); });
	parser.on("text", (value) => { if (value) stack.at(-1).children.push({ type: "text", value }); });
	parser.on("cdata", (value) => { if (value) stack.at(-1).children.push({ type: "text", value }); });
	parser.on("comment", (value) => { stack.at(-1).children.push({ type: "comment", value }); });
	try {
		parser.write(source).close();
	} catch (error) {
		parseError ??= error;
	}
	if (parseError) throw new Error(`${filename}: ${parseError.message}`);
	const roots = document.children.filter((node) => node.type === "element");
	if (roots.length !== 1 || roots[0].name !== "svg") throw new Error(`${filename}: expected one <svg> root element`);
	return roots[0];
};

const jsRaw = (value) => JSON.stringify(value).replaceAll("</", "<\\/");

const comment = (value) => `\${ ({ raw: ${jsRaw(`<!--${value}-->`)} }) }$`;

const serializeNode = (node, { isRoot = false } = {}) => {
	if (node.type === "text") return escapeText(node.value);
	if (node.type === "comment") return comment(node.value);
	const name = node.name;
	const attrs = [];
	const dynamic = [];
	for (const { name: key, value } of node.attributes) {
		if (isRoot && ["width", "height", "color"].includes(key)) {
			dynamic.push({ key, value });
			attrs.push(`${quote(key)}: \${ ${key} }$`);
		} else attrs.push(`${quote(key)}: ${quote(value)}`);
	}
	if (isRoot && dynamic.length) {
		const defaults = dynamic.map(({ key, value }) => `${key} = ${quote(value)}`).join(", ");
		return `\${ const { ${defaults} } = ArcMoon.props(); }$[${name} = ${attrs.join(", ")}]${node.children.map((child) => serializeNode(child)).join("")}[end]`;
	}
	const raw = name === "style";
	const headerAttrs = [...attrs];
	if (raw) headerAttrs.push('"arcm-raw": true');
	const header = `[${name}${headerAttrs.length ? ` = ${headerAttrs.join(", ")}` : ""}`;
	if (!node.children.length) return `${header} !]`;
	const body = node.children.map((child) => raw && child.type === "text" ? escapeRaw(child.value) : serializeNode(child)).join("");
	return `${header}]${body}[end]`;
};

export function svgToArcMoon(source, { filename = "icon.svg" } = {}) {
	if (typeof source !== "string") throw new TypeError("svgToArcMoon: source must be a string");
	const root = parseSvg(source, filename);
	return `${serializeNode(root, { isRoot: true })}\n`;
}

const packagePath = async (project, name) => {
	if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error(`Invalid npm package name: ${name}`);
	let dir = path.resolve(project);
	while (true) {
		const candidate = path.join(dir, "node_modules", ...name.split("/"));
		try {
			if ((await stat(path.join(candidate, "package.json"))).isFile()) return realpath(candidate);
		} catch {}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`Could not find "${name}" in node_modules. Install it in this project first.`);
};

const listSvgFiles = async (root) => {
	const files = [];
	const visit = async (dir) => {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			const file = path.join(dir, entry.name);
			if (entry.isDirectory()) await visit(file);
			else if (entry.isFile() && entry.name.toLowerCase().endsWith(".svg") && entry.name.toLowerCase() !== "sprite.svg") files.push(file);
		}
	};
	await visit(root);
	return files.sort();
};

const componentName = (relativeFile) => {
	const words = relativeFile.replace(/\.svg$/i, "").split(/[\\/._-]+/).filter(Boolean);
	let name = "";
	let previousWasNumber = false;
	for (const word of words) {
		const number = /^\d+$/.test(word);
		if (number && previousWasNumber) name += "_";
	name += number ? word : word[0].toUpperCase() + word.slice(1);
	previousWasNumber = number;
	}
	if (!name || !/^[A-Za-z_$]/.test(name)) name = `Icon${name}`;
	return name.replace(/[^A-Za-z0-9_$]/g, "");
};

const safeRelative = (file) => !path.isAbsolute(file) && file.split(/[\\/]/).every((part) => part && part !== "." && part !== "..");
const readManifest = async (file) => {
	try {
		const data = JSON.parse(await readFile(file, "utf8"));
		return Array.isArray(data.files) ? data.files.filter((x) => typeof x === "string" && x.endsWith(".arcm") && safeRelative(x)) : [];
	} catch {
		return [];
	}
};

export async function buildIcons({ packageName, cwd = process.cwd(), outDir = "./arcmoon-icons", svgDir, alias = "@icons" }) {
	if (!packageName) throw new Error("Missing icon package name");
	if (!/^[@A-Za-z0-9_$][A-Za-z0-9_$-]*$/.test(alias)) throw new Error(`Invalid import alias: ${alias}`);
	const installed = await packagePath(cwd, packageName);
	const sourceDir = svgDir ? path.resolve(installed, svgDir) : await (async () => {
		for (const candidate of ["icons", "svg", "svgs"]) {
			try {
				const dir = path.join(installed, candidate);
				if ((await stat(dir)).isDirectory()) return dir;
			} catch {}
		}
		return installed;
	})();
	const sources = await listSvgFiles(sourceDir);
	if (!sources.length) throw new Error(`No .svg files found in ${sourceDir}`);
	const outputRoot = path.resolve(cwd, outDir);
	const packageSlug = packageName.replace(/^@/, "").replaceAll("/", "-");
	const targetRoot = path.join(outputRoot, packageSlug);
	const names = new Map();
	const outputs = [];
	for (const source of sources) {
		const relative = path.relative(sourceDir, source);
		const relativeArcm = relative.replace(/\.svg$/i, ".arcm");
		const name = componentName(relative);
		if (names.has(name)) throw new Error(`Icon name collision: ${relative} and ${names.get(name)} both become ${name}`);
		names.set(name, relative);
		const contents = svgToArcMoon(await readFile(source, "utf8"), { filename: source });
		outputs.push({ source, relativeArcm, name, contents });
	}

	const manifestFile = path.join(targetRoot, ".arci-manifest.json");
	const previous = await readManifest(manifestFile);
	const current = new Set(outputs.map((item) => item.relativeArcm));
	await mkdir(targetRoot, { recursive: true });
	for (const stale of previous) {
		if (current.has(stale)) continue;
		await rm(path.join(targetRoot, stale), { force: true });
	}
	for (const item of outputs) {
		const target = path.join(targetRoot, item.relativeArcm);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, item.contents);
	}
	await writeFile(manifestFile, `${JSON.stringify({ package: packageName, files: [...current].sort() }, null, "\t")}\n`);
	return {
		packageName,
		count: outputs.length,
		outputRoot,
		targetRoot,
		alias,
		first: outputs[0] ? { ...outputs[0], importPath: `${alias}/${packageSlug}/${outputs[0].relativeArcm.split(path.sep).join("/")}` } : null
	};
}

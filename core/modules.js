// ###################
// ArcMoon modules: load the [import] tree and mark components
// ###################

import lexer from "./lexer.js";
import parser, { NODE_TYPES as N } from "./parser.js";

export const COMPONENT = "Component";

const MAX_DEPTH = 32;

export class ModuleError extends Error {
	constructor(message, source, range) {
		const where = range ? `${source}:${range.start.line + 1}:${range.start.character + 1}` : source;
		super(`${where}  ${message}`);
		this.name = "ModuleError";
		this.source = source;
		this.position = range ? range.start : null;
	}
}

// ###################
// host.resolve(path, fromFile) -> file id
// host.readFile(file) -> source text
// ###################
export default async function loadModules(entry, host, options = {}) {
	const aliases = options.importAliases ?? {};
	const modules = new Map();
	const stack = [];

	const applyAlias = (path) => {
		for (const [alias, target] of Object.entries(aliases)) {
			// one "/" between them, so a target of "/" or "./" doesn't give "//file"
			if (path === alias || path.startsWith(alias + "/")) return (target.replace(/\/+$/, "") + path.slice(alias.length)) || target;
		}
		return path;
	};

	// ###################
	// Blocks named like an import become components
	// ###################
	const markComponents = (nodes, imports) => {
		for (let k = 0; k < nodes.length; k++) {
			const node = nodes[k];
			if (!node.body) continue;
			markComponents(node.body, imports);
			if (node.type === N.BLOCK && imports.has(node.id)) {
				nodes[k] = {
					type: COMPONENT,
					name: node.id,
					module: imports.get(node.id),
					props: node.props,
					directives: node.directives,
					isSelfClosing: node.isSelfClosing,
					body: node.body,
					range: node.range
				};
			}
		}
	};

	// ###################
	// Load one file, then its imports
	// ###################
	const visit = async (id, text, from) => {
		const fail = (message) => {
			if (from) throw new ModuleError(message, from.id, from.node.range);
			throw new ModuleError(message, id);
		};

		if (stack.includes(id)) fail(`circular import: ${[...stack.slice(stack.indexOf(id)), id].join(" → ")}`);
		if (modules.has(id)) return;
		if (stack.length >= MAX_DEPTH) fail(`imports are nested more than ${MAX_DEPTH} levels deep`);

		let src = text;
		if (src === undefined) {
			try {
				src = await host.readFile(id);
			} catch (err) {
				const path = from ? from.node.path : id;
				// "@/x", "~/x", "#x", "$x" look like aliases (an npm scope can't be empty): say why it failed
				const alias = /^(@(?=\/)|[~#$][^/]*)/.exec(path)?.[0];
				if (from && alias && applyAlias(path) === path) {
					fail(`can't read "${path}": "${alias}" isn't an import alias here. Aliases come from importAliases in arcmoon.config.js, which is only read from the folder where arcm runs`);
				}
				fail(`can't read "${path}" (${id}): ${err.message}`);
			}
		}

		stack.push(id);
		const ast = parser(lexer(src, id));
		const imports = new Map();

		for (const node of ast) {
			if (node.type !== N.IMPORT) continue;
			const at = (message) => {
				throw new ModuleError(message, id, node.range);
			};
			if (imports.has(node.name)) at(`"${node.name}" is imported twice`);
			if (!node.path.endsWith(".arcm")) at(`[import] only loads .arcm files, got "${node.path}"`);

			const target = host.resolve(applyAlias(node.path), id);
			imports.set(node.name, target);
			await visit(target, undefined, { id, node });
		}

		markComponents(ast, imports);
		stack.pop();
		modules.set(id, { id, src, ast, imports });
	};

	await visit(entry.id, entry.src, null);
	return { entry: entry.id, modules };
}

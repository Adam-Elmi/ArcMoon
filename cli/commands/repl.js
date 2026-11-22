// ###################
// ArcMoon REPL: interactive command-line environment for ArcMoon
// ###################

import repl from "node:repl";
import readline from "node:readline";
import path from "node:path";
import os from "node:os";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import pc from "picocolors";
import * as acorn from "acorn";
import ArcMoon from "../../node/compiler.js";
import lexer from "../../core/lexer.js";
import parser from "../../core/parser.js";
import pkg from "../../package.json" with { type: "json" };
import { loadConfig } from "../helpers/config.js";

// ###################
// Detect whether code has an explicit line continuation (trailing backslash)
// ###################
export function isRecoverable(code) {
	return code.trimEnd().endsWith("\\");
}

// ###################
// Format REPL compiler errors with picocolors
// ###################
export function formatReplError(err) {
	const text = String(err?.message ?? err);
	const at = text.indexOf("  ");
	const message = at !== -1 && err?.source && text.startsWith(err.source) ? text.slice(at + 2) : text;
	const lines = [`${pc.red("✗")} ${pc.bold(message)}`];
	if (err?.position) {
		lines.push(`  ${pc.cyan(`line ${err.position.line + 1}:${err.position.character + 1}`)}`);
	}
	return lines.join("\n") + "\n";
}

// ###################
// Extract JS declarations (const/let/var, function, class) to persist in session
// Changes const / let to var to allow re-declaration across REPL turns
// ###################
export function extractDeclarations(js) {
	try {
		const ast = acorn.parse(js, { ecmaVersion: "latest", sourceType: "module" });
		const decls = ast.body.filter(
			(s) =>
				s.type === "VariableDeclaration" ||
				s.type === "FunctionDeclaration" ||
				s.type === "ClassDeclaration"
		);
		if (!decls.length) return null;
		let res = js;
		const vars = decls.filter(
			(s) => s.type === "VariableDeclaration" && (s.kind === "const" || s.kind === "let")
		);
		vars.sort((a, b) => b.start - a.start);
		for (const v of vars) {
			res = res.slice(0, v.start) + "var " + res.slice(v.start + v.kind.length + 1);
		}
		return res;
	} catch {
		return null;
	}
}

// ###################
// Run the ArcMoon REPL
// ###################
export async function runRepl(options = {}) {
	const config = await loadConfig();
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stdout;
	const isInteractive = options.terminal ?? Boolean(input.isTTY);

	if (isInteractive && options.banner !== false) {
		output.write(
			`${pc.bold(pc.cyan(`ArcMoon v${pkg.version}`))} ${pc.bold("REPL")}\nType ArcMoon template code to evaluate, or ${pc.cyan(".help")} for commands.\n\n`
		);
	}

	const session = {
		imports: [],
		declarations: []
	};

	let isClosed = false;
	let queue = Promise.resolve();

	const safePrompt = (srv) => {
		if (!isClosed) {
			try {
				srv.displayPrompt();
			} catch {}
		}
	};

	const evalInput = async (code) => {
		const parts = [...session.imports, ...session.declarations, code];
		const fullSrc = parts.join("\n");
		const html = await new ArcMoon({
			src: fullSrc,
			cwd: process.cwd(),
			importAliases: config.importAliases ?? {},
			removeComments: config.removeComments ?? true,
			timeout: config.timeout ?? 5000,
			bundle: config.bundle ?? [],
			packages: config.packages ?? {},
			onWarning: (w) => output.write(`${pc.yellow("⚠")} ${pc.yellow(w.message ?? w)}\n`)
		}).compile();

		// Record top-level imports and declarations for session persistence
		try {
			const ast = parser(lexer(code, "repl.arcm"));
			for (const node of ast) {
				if (node.type === "Import") {
					const stmt = `[import = ${node.name}: "${node.path}" !]`;
					if (!session.imports.includes(stmt)) session.imports.push(stmt);
				} else if (node.type === "StaticLogic") {
					const decl = extractDeclarations(node.code);
					if (decl) session.declarations.push(`\${ ${decl.trim()} }\$`);
				}
			}
		} catch {}

		return html;
	};

	const server = repl.start({
		prompt: pc.cyan("arcmoon> "),
		input,
		output,
		terminal: isInteractive,
		ignoreUndefined: true,
		writer: (v) => (typeof v === "string" ? v : v),
		eval: (cmd, context, filename, callback) => {
			const code = cmd.trim();
			if (!code) return callback(null, undefined);

			if (isRecoverable(cmd)) {
				return callback(new repl.Recoverable(new Error("Incomplete input")));
			}

			const cleanCode = code.replace(/\\\r?\n/g, "\n").trim();

			queue = queue
				.then(async () => {
					try {
						const html = await evalInput(cleanCode);
						if (!html || html.trim() === "") {
							return callback(null, undefined);
						}
						return callback(null, html);
					} catch (err) {
						output.write(formatReplError(err));
						return callback(null, undefined);
					}
				})
				.catch((err) => {
					output.write(formatReplError(err));
					callback(null, undefined);
				});
		}
	});

	// Reset session on .clear
	server.on("reset", () => {
		queue = queue.then(() => {
			session.imports = [];
			session.declarations = [];
			output.write(pc.dim("Session cleared.\n"));
		});
	});

	server.on("close", () => {
		isClosed = true;
	});

	// Custom dot commands
	server.defineCommand("ast", {
		help: "Print AST of ArcMoon code",
		action(code) {
			this.clearBufferedCommand();
			const src = code.trim();
			if (!src) {
				output.write(`${pc.yellow("Usage:")} ${pc.cyan(".ast <arcmoon-code>")}\n`);
				safePrompt(this);
				return;
			}
			queue = queue
				.then(() => {
					try {
						const ast = parser(lexer(src, "repl.arcm"));
						output.write(JSON.stringify(ast, null, 2) + "\n");
					} catch (err) {
						output.write(`${pc.red("✗")} ${err.message ?? err}\n`);
					}
					safePrompt(this);
				})
				.catch(() => safePrompt(this));
		}
	});

	server.defineCommand("lex", {
		help: "Print tokens of ArcMoon code",
		action(code) {
			this.clearBufferedCommand();
			const src = code.trim();
			if (!src) {
				output.write(`${pc.yellow("Usage:")} ${pc.cyan(".lex <arcmoon-code>")}\n`);
				safePrompt(this);
				return;
			}
			queue = queue
				.then(() => {
					try {
						const tokens = lexer(src, "repl.arcm");
						output.write(JSON.stringify(tokens, null, 2) + "\n");
					} catch (err) {
						output.write(`${pc.red("✗")} ${err.message ?? err}\n`);
					}
					safePrompt(this);
				})
				.catch(() => safePrompt(this));
		}
	});

	server.defineCommand("show", {
		help: "Show accumulated session imports and declarations",
		action() {
			this.clearBufferedCommand();
			queue = queue
				.then(() => {
					if (session.imports.length === 0 && session.declarations.length === 0) {
						output.write(pc.dim("(no session imports or declarations)\n"));
					} else {
						if (session.imports.length > 0) {
							output.write(pc.bold(pc.cyan("Imports:\n")));
							for (const imp of session.imports) output.write(`  ${pc.green(imp)}\n`);
						}
						if (session.declarations.length > 0) {
							output.write(pc.bold(pc.cyan("Declarations:\n")));
							for (const decl of session.declarations) output.write(`  ${pc.yellow(decl)}\n`);
						}
					}
					safePrompt(this);
				})
				.catch(() => safePrompt(this));
		}
	});

	server.defineCommand("load", {
		help: "Load an ArcMoon file into the REPL session",
		action(file) {
			this.clearBufferedCommand();
			const filePath = file.trim();
			if (!filePath) {
				output.write(`${pc.yellow("Usage:")} ${pc.cyan(".load <file>")}\n`);
				safePrompt(this);
				return;
			}
			const resolved = path.resolve(process.cwd(), filePath);
			queue = queue
				.then(async () => {
					try {
						const content = await readFile(resolved, "utf8");
						const html = await evalInput(content);
						if (html && html.trim() !== "") output.write(html + "\n");
						output.write(`${pc.green("✓")} Loaded ${pc.cyan(filePath)}\n`);
					} catch (err) {
						output.write(`${pc.red("✗")} Error loading ${pc.cyan(filePath)}: ${err.message}\n`);
					}
					safePrompt(this);
				})
				.catch(() => safePrompt(this));
		}
	});

	const startMultilineEditor = async (srv, external = false) => {
		if (external) {
			const editor =
				process.env.VISUAL ||
				process.env.EDITOR ||
				(process.platform === "win32" ? "notepad" : "nano");
			const tempFile = path.join(os.tmpdir(), `arcmoon-repl-${Date.now()}.arcm`);
			await writeFile(tempFile, "");
			try {
				srv.pause();
				spawnSync(editor, [tempFile], { stdio: "inherit" });
				srv.resume();
				const content = await readFile(tempFile, "utf8");
				if (content.trim()) {
					output.write(content + "\n");
					queue = queue
						.then(async () => {
							try {
								const html = await evalInput(content.trim());
								if (html && html.trim() !== "") output.write(html + "\n");
							} catch (err) {
								output.write(`${pc.red("✗")} ${err.message ?? err}\n`);
							}
							safePrompt(srv);
						})
						.catch(() => safePrompt(srv));
					return;
				}
			} catch (err) {
				output.write(`${pc.red("✗")} Error launching ${editor}: ${err.message}\n`);
			} finally {
				await unlink(tempFile).catch(() => {});
			}
			safePrompt(srv);
			return;
		}

		if (!isInteractive) {
			output.write(pc.yellow("Editor mode requires an interactive terminal.\n"));
			safePrompt(srv);
			return;
		}

		output.write(
			`// Entering editor mode (${pc.cyan("Up/Down")} to navigate lines, ${pc.cyan("Ctrl+D")} to evaluate, ${pc.dim("Ctrl+C")} to cancel)\n`
		);

		const origTtyWrite = srv._ttyWrite;
		const lines = [""];
		let row = 0;
		let col = 0;
		let lastRow = 0;
		const prefix = pc.dim("... ");
		const prefixLen = 4;

		const render = () => {
			if (lastRow > 0) readline.moveCursor(output, 0, -lastRow);
			readline.cursorTo(output, 0);
			readline.clearScreenDown(output);

			for (let i = 0; i < lines.length; i++) {
				output.write(prefix + lines[i] + (i < lines.length - 1 ? "\n" : ""));
			}

			const linesFromBottom = lines.length - 1 - row;
			if (linesFromBottom > 0) readline.moveCursor(output, 0, -linesFromBottom);
			readline.cursorTo(output, prefixLen + col);
			lastRow = row;
		};

		render();

		srv._ttyWrite = function (s, key) {
			if (key?.ctrl && key?.name === "c") {
				srv._ttyWrite = origTtyWrite;
				const down = lines.length - 1 - row;
				if (down > 0) readline.moveCursor(output, 0, down);
				output.write("\n" + pc.dim("(canceled)\n"));
				safePrompt(srv);
				return;
			}

			if (key?.ctrl && key?.name === "d") {
				srv._ttyWrite = origTtyWrite;
				const down = lines.length - 1 - row;
				if (down > 0) readline.moveCursor(output, 0, down);
				output.write("\n");
				const code = lines.join("\n").trim();
				if (!code) {
					safePrompt(srv);
					return;
				}
				queue = queue
					.then(async () => {
						try {
							const html = await evalInput(code);
							if (html && html.trim() !== "") output.write(html + "\n");
						} catch (err) {
							output.write(formatReplError(err));
						}
						safePrompt(srv);
					})
					.catch(() => safePrompt(srv));
				return;
			}

			if (key?.name === "up") {
				if (row > 0) {
					row--;
					col = Math.min(col, lines[row].length);
					render();
				}
				return;
			}

			if (key?.name === "down") {
				if (row < lines.length - 1) {
					row++;
					col = Math.min(col, lines[row].length);
					render();
				}
				return;
			}

			if (key?.name === "left") {
				if (col > 0) {
					col--;
					render();
				} else if (row > 0) {
					row--;
					col = lines[row].length;
					render();
				}
				return;
			}

			if (key?.name === "right") {
				if (col < lines[row].length) {
					col++;
					render();
				} else if (row < lines.length - 1) {
					row++;
					col = 0;
					render();
				}
				return;
			}

			if (key?.name === "home" || (key?.ctrl && key?.name === "a")) {
				col = 0;
				render();
				return;
			}

			if (key?.name === "end" || (key?.ctrl && key?.name === "e")) {
				col = lines[row].length;
				render();
				return;
			}

			if (key?.name === "return" || key?.name === "enter") {
				const rest = lines[row].slice(col);
				lines[row] = lines[row].slice(0, col);
				lines.splice(row + 1, 0, rest);
				row++;
				col = 0;
				render();
				return;
			}

			if (key?.name === "backspace") {
				if (col > 0) {
					lines[row] = lines[row].slice(0, col - 1) + lines[row].slice(col);
					col--;
					render();
				} else if (row > 0) {
					col = lines[row - 1].length;
					lines[row - 1] += lines[row];
					lines.splice(row, 1);
					row--;
					render();
				}
				return;
			}

			if (key?.name === "delete") {
				if (col < lines[row].length) {
					lines[row] = lines[row].slice(0, col) + lines[row].slice(col + 1);
					render();
				} else if (row < lines.length - 1) {
					lines[row] += lines[row + 1];
					lines.splice(row + 1, 1);
					render();
				}
				return;
			}

			if (key?.name === "tab") {
				lines[row] = lines[row].slice(0, col) + "  " + lines[row].slice(col);
				col += 2;
				render();
				return;
			}

			if (s && !key?.ctrl && !key?.meta && key?.name !== "enter" && key?.name !== "return") {
				const parts = s.split(/\r?\n/);
				for (let i = 0; i < parts.length; i++) {
					if (i > 0) {
						const rest = lines[row].slice(col);
						lines[row] = lines[row].slice(0, col);
						lines.splice(row + 1, 0, rest);
						row++;
						col = 0;
					}
					const text = parts[i];
					if (text) {
						lines[row] = lines[row].slice(0, col) + text + lines[row].slice(col);
						col += text.length;
					}
				}
				render();
			}
		};
	};

	server.defineCommand("editor", {
		help: "Enter multiline editor mode (navigate lines with Up/Down, or -e for $EDITOR)",
		action(arg) {
			this.clearBufferedCommand();
			const trimmed = (arg ?? "").trim();
			const useExternal = trimmed === "-e" || trimmed === "--external" || trimmed === "external";
			startMultilineEditor(this, useExternal);
		}
	});

	server.defineCommand("help", {
		help: "Print this help message",
		action() {
			this.clearBufferedCommand();
			output.write(`\n${pc.bold(pc.cyan("ArcMoon REPL Commands:"))}\n`);
			const cmds = [
				[".editor", "Enter multiline editor mode (navigate lines with Up/Down, or -e for $EDITOR)"],
				[".ast <code>", "Print AST of ArcMoon code"],
				[".lex <code>", "Print tokens of ArcMoon code"],
				[".show", "Show accumulated session imports and declarations"],
				[".load <file>", "Load an ArcMoon file into the REPL session"],
				[".clear", "Clear current session variables and imports"],
				[".help", "Print this help message"],
				[".exit", "Exit the REPL (Ctrl+D)"]
			];
			for (const [cmd, desc] of cmds) {
				output.write(`  ${pc.cyan(cmd.padEnd(16))} ${pc.dim(desc)}\n`);
			}
			output.write(`\n${pc.dim("Shortcuts:")} ${pc.cyan("Ctrl+C")} ${pc.dim("abort expression,")} ${pc.cyan("Ctrl+D")} ${pc.dim("exit REPL")}\n\n`);
			safePrompt(this);
		}
	});

	// History file in user home dir
	if (typeof server.setupHistory === "function" && isInteractive && input.isTTY) {
		const historyPath =
			process.env.ARCMOON_REPL_HISTORY || path.join(os.homedir(), ".arcmoon_repl_history");
		server.setupHistory(historyPath, () => {});
	}

	return server;
}

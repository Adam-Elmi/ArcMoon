import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPages } from "./node/compiler.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcm-"));
fs.writeFileSync(
  path.join(dir, "Counter.arcm"),
  `runtime \${
  import { signal } from "arcmoon/reactive";
  const label = signal("MARKER_9f3a");
  const count = signal(0);
}$
[p]runtime \${ label() }$ runtime \${ count() }$[end]
`,
);
const pages = [0, 1, 2, 3, 4].map((i) => {
  const filename = path.join(dir, `page${i}.arcm`);
  const src = `[import = Counter: "./Counter.arcm" !]\n[Counter !]\n`;
  fs.writeFileSync(filename, src);
  return { name: `page${i}`, filename, src, cwd: dir };
});
const out = await buildPages(pages, {
  cwd: dir,
  outDir: path.join(dir, "dist"),
  onWarning() {},
});
const hits = out.files.filter(
  (f) => f.path.endsWith(".js") && f.contents.includes("MARKER_9f3a"),
);
console.log("files containing Counter's code:", hits.length, "(expected 1)");

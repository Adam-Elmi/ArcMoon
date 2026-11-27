# V1.2.0
## Bugs to be fixed
- [x] arcm trust `<dir>` causes hash mismatch loop for outside templates:

    **Reproduction**:
    
    When importing components from an outside folder (e.g. ../random), running arcm trust ../random creates an infinite trust loop or fails to build.
    
    ```sh
    # 1. Setup outside folder with 2 components
    mkdir -p random project
    echo '[h1]Button[end]' > random/Button.arcm
    echo '[h1]Modal[end]'  > random/Modal.arcm
    ```
    
    ```sh
    # 2. Project page imports one component
    echo '[import = Btn: "../random/Button.arcm" !][Btn!]' > project/page.arcm
    ```
    
    ```sh
    cd project
    arcm build page.arcm
    # ⚠ Template "../random" is not trusted.
    #   Review it, then run "arcmoon trust ../random".
    ```
    
    ```sh
    # 3. Trust as instructed:
    arcm trust ../random
    # ✓ Trusted "../random" (sha256-button...)
    # ✓ Trusted "../random" (sha256-modal...) <- Overwrites button's hash!
    ```
    
    ```sh
    # 4. Try building again:
    arcm build page.arcm
    # ⚠ Template "../random" has changed since it was trusted.
    #   Review it, then run "arcmoon trust ../random". (Infinite loop)
    ```


- [x]  **Issue:** in files mode (`buildPages`), a reactive component used on several pages is copied into every page's JS entry instead of being shared in one chunk.

  - **Cause:** `node/runtime.js` names each file's browser-function module `arcm-file:${page.index}:${i}`. The page number is in the name, so esbuild (`splitting: true`) treats the same component on two pages as two different modules. The function text is identical on every page, and only its generated name differs.

**Reproduction:**

```js
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { buildPages } from "./node/compiler.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcm-"));
fs.writeFileSync(path.join(dir, "Counter.arcm"), `runtime \${
  import { signal } from "arcmoon/reactive";
  const label = signal("MARKER_9f3a");
  const count = signal(0);
}$
[p]runtime \${ label() }$ runtime \${ count() }$[end]
`);
const pages = [0, 1, 2, 3, 4].map((i) => {
  const filename = path.join(dir, `page${i}.arcm`);
  const src = `[import = Counter: "./Counter.arcm" !]\n[Counter !]\n`;
  fs.writeFileSync(filename, src);
  return { name: `page${i}`, filename, src, cwd: dir };
});
const out = await buildPages(pages, { cwd: dir, outDir: path.join(dir, "dist"), onWarning() {} });
const hits = out.files.filter((f) => f.path.endsWith(".js") && f.contents.includes("MARKER_9f3a"));
console.log("files containing Counter's code:", hits.length, "(expected 1)");
```

**Result now:** `files containing Counter's code: 5 (expected 1)`.

## New Features
1. [x] Add built-in utils that you can easily import them. For example: 
  ```js 
  ${
    import { onResize } from "arcmoon/utils";
  }$
  ```
2. [x] Add REPL for ArcMoon
3. [x] Add ArcMoon development server
4. [ ] ArcMoon Packages: Ready-made .arcm files you can drop into any page
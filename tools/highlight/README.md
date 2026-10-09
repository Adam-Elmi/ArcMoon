# arcmoon-highlight

Syntax highlighting for [ArcMoon](https://github.com/Adam-Elmi/ArcMoon) (`.arcm` files). It uses ArcMoon's own lexer, so it reads code exactly the way ArcMoon does.

- **Static:** turns ArcMoon code into highlighted HTML. Works in Node.js and the browser.
- **Live editor:** a CodeMirror 6 editor that highlights as you type and shows errors.
- **Errors:** ArcMoon's syntax errors, JavaScript errors inside every `${ }$`, and ArcMoon's rules for code, each at the exact spot.
- JavaScript inside `${ }$` and `runtime ${ }$` is highlighted too.

## Install

```bash
npm install arcmoon-highlight
```

ArcMoon's own lexer and parser are built in, so you don't need to install `arcmoon`. Each version of the highlighter reads the syntax of the ArcMoon released with it.

## Static highlighting

```js
import { staticHighlight } from "arcmoon-highlight";

const html = staticHighlight(`[div = class: "hero"]
  [h1]Hello[end]
[end]`);

document.querySelector("pre").innerHTML = html;
```

It never throws. Half-written code (an open string, an open `${`) is highlighted up to the problem, and the rest is plain text.

### Your own colors

```js
const html = staticHighlight(src, {
  tokens: {
    IDENTIFIER: "#f472b6",
    KEY: "#34d399",
    END_KEYWORD: { color: "#6366f1", bold: true },
    COMMENT: { color: "#4b4f68", italic: true }
  }
});
```

Each entry in `tokens` can be:

| Form | Example | What it does |
| --- | --- | --- |
| A color | `"#f472b6"` | Text color |
| `{ color, bold, italic }` | `{ color: "#f00", bold: true }` | Color and font style |
| `{ render }` | `{ render: (value, type) => "<b>" + value + "</b>" }` | Returns the HTML for the token |
| `{ context }` | `{ context: ({ prev, current, next }) => … }` | Decides from the tokens around it. Return `undefined` to use the next rule |
| `null` | `null` | No color |

`render` and `context` return HTML, so escape the text yourself.

**`other`** is used for every token type not in `tokens`:

```js
staticHighlight(src, { tokens: { IDENTIFIER: "#60a5fa" }, other: "#8b8fa8" });
```

**`onToken`** runs first, for every token. Return HTML to use it, or `undefined` to go on:

```js
staticHighlight(src, {
  onToken: ({ prev, current, next }) => {
    if (current.type === "IDENTIFIER" && /^[A-Z]/.test(current.value)) return `<span class="component">${current.value}</span>`;
  }
});
```

**The order:** `onToken` → `tokens[type]` → `other` → the default colors → plain text.

### CSS themes: `classPrefix`

Inline colors can't follow a light / dark theme. With `classPrefix`, every token gets a class instead:

```js
staticHighlight(src, { classPrefix: "arcm-" });
// <span class="arcm-identifier">p</span> … <span class="arcm-js-keyword">const</span>
```

The class is the prefix plus the token type in lowercase with dashes (`END_KEYWORD` → `arcm-end-keyword`). JavaScript inside `${ }$` gets `arcm-js-keyword`, `arcm-js-call`, `arcm-js-key`, `arcm-js-property`, `arcm-js-string`, `arcm-js-number`, `arcm-js-regex`, `arcm-js-comment`, `arcm-js-operator` and `arcm-js-name`.

### Errors in static code

Off by default. Pass a list of errors, and each one gets a wavy underline with its message on hover. Good for teaching: show a mistake and what ArcMoon says about it.

```js
import { staticHighlight } from "arcmoon-highlight";
import { diagnose } from "arcmoon-highlight/diagnostics";

const src = `\${ cosnt a = 1; }$`;
const html = staticHighlight(src, { errors: diagnose(src) });
```

- ArcMoon errors are underlined in rose, JavaScript errors in orange.
- The list can be your own: `{ from, to, message, source? }` marks any part of the code, for example to point at something in a lesson.
- With `classPrefix: "arcm-"`, an error is `<span class="arcm-error arcm-error-javascript" title="…">` (or `arcm-error-arcmoon`), so CSS draws it.

`diagnose` is a separate import so the static highlighter stays small: the checker (acorn) is only loaded when you use it.

### Default colors

```js
import { staticHighlight, defaultTokens } from "arcmoon-highlight";

staticHighlight(src, { tokens: { ...defaultTokens, IDENTIFIER: "#f472b6" } });
```

## Live editor

Install CodeMirror next to it:

```bash
npm install @codemirror/view @codemirror/state @codemirror/commands @codemirror/lint
```

```js
import { attachHighlighter } from "arcmoon-highlight/dynamic";

const editor = attachHighlighter(document.getElementById("editor"), {
  tokens: { IDENTIFIER: "#60a5fa" },
  onDiagnostics: (errors) => showList(errors)
});

editor.setValue(`[h1]Hello[end]`);
editor.onUpdate((code) => console.log(code));
```

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `tokens`, `other`, `onToken` | | Colors, the same as `staticHighlight` |
| `classPrefix` | | Class names instead of the default colors, the same as `staticHighlight`'s (`arcm-identifier`, `arcm-js-keyword`…), so one set of CSS rules colors both, in any theme |
| `caretColor` | `"#e8eaf0"` | Cursor color |
| `showLineNumbers` | `true` | Line numbers on the left |
| `showErrors` | `true` | Draw errors in the editor: a wavy line, a dot next to the line number, and the message on hover |
| `rules` | `true` | Also check ArcMoon's rules for code (see [Errors](#errors)) |
| `onDiagnostics` | | Called with the list of errors after each check (`[]` when there are none) |
| `onError` | | Called with the first error as text (`"JavaScript: Unexpected token"`), or `null` |

**Your own error UI:** set `onDiagnostics` and `showErrors: false`. The code is still checked and you get every error, but the editor draws nothing.

```js
const editor = attachHighlighter(el, {
  showErrors: false,
  onDiagnostics: (errors) => {
    list.replaceChildren(...errors.map((e) => {
      const item = document.createElement("li");
      item.textContent = `${e.source} ${e.line}:${e.column} ${e.message}`;
      item.onclick = () => editor.goTo(e);
      return item;
    }));
  }
});
```

### Methods

| Method | What it does |
| --- | --- |
| `getValue()` | The editor's code |
| `setValue(code)` | Replaces the code |
| `onUpdate(fn)` | Calls `fn(code)` after each change |
| `goTo(error)` | Selects an error (or any `{ from, to }`), scrolls to it and focuses the editor |
| `destroy()` | Removes the editor |
| `view` | The CodeMirror `EditorView`, for anything else |

## Errors

The editor checks the code a moment after you stop typing. You can also check code yourself:

```js
import { diagnose } from "arcmoon-highlight/diagnostics";

diagnose(`\${ cosnt a = 1; }$\n[p]x[end][end]`);
// [
//   { from: 3, to: 8, line: 1, column: 4, text: "cosnt", severity: "error",
//     source: "JavaScript", message: 'Unexpected token (did you mean "const"?)' },
//   { from: 29, to: 32, line: 2, column: 11, text: "end", severity: "error",
//     source: "ArcMoon", message: "[end] has no open block to close" }
// ]
```

| Field | What it is |
| --- | --- |
| `source` | `"ArcMoon"` or `"JavaScript"`: where the error comes from |
| `message` | What is wrong |
| `line`, `column` | Where it starts, counted from 1 |
| `text` | The underlined part of the code |
| `from`, `to` | The same place as offsets in the code (for `goTo` and `errors`) |
| `severity` | `"error"` |

In the editor, ArcMoon errors have a rose line and JavaScript errors an orange one.

**ArcMoon:** the syntax of the markup, from ArcMoon's own parser (`[end] has no open block to close`). After one of these the markup can't be read further, so there is at most one.

**JavaScript:** every `${ }$` and `runtime ${ }$` is parsed on its own, like ArcMoon does. A value in a prop or in text is one expression; a block can hold statements.
- `${ const a = (1 + 2; }$` → `Unexpected token` at the `;`
- `${ cosnt a = 1; }$` → `Unexpected token (did you mean "const"?)`
- `${ if (a) { b(); }$` → `this { is never closed` at the `{`
- `${ const a = "hi; }$` → `Unterminated string constant` at the `"`

An open string or `{` makes ArcMoon read past `}$`, which would only say "logic block is not closed". The checker finds the real mistake in the code instead.

**ArcMoon's rules for code** (turn them off with `rules: false`):

| Code | Error |
| --- | --- |
| `[p]runtime ${ let x = 1 }$[end]` | A live value must be one expression |
| `runtime ${ export const a = 1; }$` | `export` is not allowed in runtime code |
| `runtime ${ import fs from "node:fs"; }$` | A Node.js module doesn't exist in the browser |
| `runtime ${ ArcMoon.defineRef(name) }$` | `defineRef()` needs a quoted name |
| `${ ArcMoon.ref(x) }$` | `ref()`, `refs()` and `defineRef()` only work in runtime code |
| `${ return 1; more(); }$` | `return` must be the last statement |
| `[p = t: ${ import a from "a"; }$]` | `import` / `export` only in a `${ }$` block, not in a prop value |
| `${ export default 1; }$` | Only named exports |

Checks that need the whole project (packages listed in `bundle`, names exported from `${ }$`, refs) are left to [ArcMoon-LSP](https://github.com/Adam-Elmi/ArcMoon-LSP).

## CDN

Two bundles in `dist/`. Both give a global `ArcMoonHighlight`, with ArcMoon's lexer inside.

```html
<!-- static only: staticHighlight, defaultTokens, tokenize, highlightJs (14 KB gzipped; no diagnose) -->
<script src="https://cdn.jsdelivr.net/npm/arcmoon-highlight/dist/arcmoon-highlight.js"></script>

<!-- static + errors + the live editor, CodeMirror inside (155 KB gzipped) -->
<script src="https://cdn.jsdelivr.net/npm/arcmoon-highlight/dist/arcmoon-highlight.full.js"></script>

<script>
  const { staticHighlight, diagnose, attachHighlighter } = ArcMoonHighlight;
</script>
```

## Token types

| Token | What it is |
| --- | --- |
| `OPEN_BRACKET`, `CLOSE_BRACKET` | `[` and `]` |
| `IDENTIFIER` | A block name: `div`, `h1`, `Card` |
| `END_KEYWORD` | `end` or `end:name` |
| `IMPORT`, `SLOT`, `FOR_EACH` | The built-in blocks `import`, `slot`, `for-each` |
| `KEY` | A prop name: `class`, `id` |
| `EQUAL`, `COLON`, `COMMA` | `=`, `:`, `,` |
| `EXCLAMATION_MARK` | `!` in `[br!]` |
| `STRING` | A quoted value, quotes included |
| `NUMBER`, `BOOLEAN` | `100`, `true` |
| `WORD` | Any other unquoted value |
| `TEXT` | Text between blocks |
| `ESCAPE` | `\[`, `\#` and other escapes |
| `COMMENT`, `COMMENT_BLOCK` | `# …` and `### … ###` |
| `RUNTIME_KEYWORD` | `runtime` before `${` |
| `LOGIC_OPEN`, `LOGIC`, `LOGIC_CLOSE` | `${`, the JavaScript, `}$` |

Each token passed to `context` and `onToken` is `{ type, value, from, to }`: `value` is the text as written, `from` / `to` are offsets in the source. `tokenize(src)` gives the same list.

## Demo

```bash
npm run build
```

Then open `browser/index.html`.

## Working on it

This package lives in the ArcMoon repo (`tools/highlight`) and imports ArcMoon's lexer and parser straight from `../../core`. `npm test` runs on the source; `npm run build` bundles the core into `dist/`.

## License

MIT

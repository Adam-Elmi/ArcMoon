<p align="center">
  <img src="assets/arcmoon-logo.svg" alt="ArcMoon logo" width="120">
</p>

<h1 align="center">ArcMoon</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/arcmoon"><img src="https://img.shields.io/npm/v/arcmoon?color=d9263f&label=npm" alt="npm version"></a>
  <img src="https://img.shields.io/badge/license-MIT-3b82f6" alt="MIT license">
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white" alt="Node.js 22.12 or newer">
</p>

<p align="center">ArcMoon is a template language. You write <code>.arcm</code> files, and ArcMoon builds them into web pages.</p>

> **Release candidate for 1.0.** This is what 1.0 will be, unless a bug is found. Install it with `npm install arcmoon@rc`.

## What is ArcMoon?

Here is what a `.arcm` file can hold.

**Blocks become HTML tags.**

```ini
[p = class: "note"]Hello[end]
```

```html
<p class="note">Hello</p>
```

**`${ }$` runs once, while the page is built.** It runs in Node.js, so it can read files and use npm packages. Its result is written into the page.

```ini
${ const year = new Date().getFullYear(); }$
[footer]© ${ year }$[end]
```

```html
<footer>© 2026</footer>
```

**`runtime ${ }$` runs in the visitor's browser.** Use it for things that change after the page loads, like clicks. The count below updates on each click.

```ini
runtime ${
  import { signal } from "arcmoon/reactive";
  const count = signal(0);
}$
[button = onclick: runtime ${ () => count(count() + 1) }$]
  Clicked runtime ${ count() }$ times
[end]
```

**Components are `.arcm` files you import.** A component's `[style]` only styles that component.

```ini
# Card.arcm
${ const { title } = ArcMoon.props(); }$
[div = class: "card"]
  [h2]${ title }$[end]
[end]
[style]
  h2 { color: tomato; }
[end]
```

```ini
# page.arcm
[import = Card: "./Card.arcm" !]
[Card = title: "Lua" !]
```

**The output is plain HTML**, with only the CSS and JavaScript that page needs.

## Installation

Install the `arcm` command:

```bash
npm install -g arcmoon
```

Check that it works:

```bash
arcm -v
```

`arcmoon` and its short name `arcm` are the same command.

To use ArcMoon from JavaScript, install it in your project instead:

```bash
npm install arcmoon
```

ArcMoon needs Node.js 22.12 or newer.

## Versions

ArcMoon follows [semver](https://semver.org). From 1.0, every 1.x release keeps working with your pages:

- **Kept in 1.x:** the `.arcm` syntax, the `arcm-*` props, `css.` and `--` props, `ArcMoon.*` in `.arcm` files, `arcmoon/reactive`, the CLI commands and flags, the config keys, and the JavaScript API (`compile()`, `build()`, `buildPages()`, `render()`). A 1.x release can add to these, but never changes them.
- **Can change in any release:** the exact bytes of the output (whitespace, minifying, file names), names ArcMoon makes for itself (`data-a-…`, `data-arcm-ref`), the text of errors and warnings, and `arcmoon/core`.
- **Bug fixes:** if ArcMoon does something the docs don't say, fixing it is not a breaking change.

## License

MIT © Adam Elmi

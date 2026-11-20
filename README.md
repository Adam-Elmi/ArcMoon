<p align="center">
  <img src="assets/arcmoon-new-logo.svg" alt="ArcMoon logo" width="120">
</p>

<h1 align="center">ArcMoon</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/arcmoon"><img src="https://img.shields.io/npm/v/arcmoon?color=8b5cf6&label=npm" alt="npm version"></a>
  <a href="https://adam-elmi.github.io/ArcMoon-Site/docs/"><img src="https://img.shields.io/badge/docs-read-14b8a6" alt="Documentation"></a>
  <a href="https://adam-elmi.github.io/ArcMoon-Site/playground.html"><img src="https://img.shields.io/badge/playground-try%20it-f59e0b" alt="Try it in the playground"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white" alt="Node.js 22.12 or newer">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3b82f6" alt="MIT license"></a>
</p>

## What is ArcMoon?

ArcMoon is a template language for web pages. You write .arcm files, and ArcMoon compiles them to plain HTML. Pages ship zero JavaScript and zero CSS by default: you get plain HTML, and a page only includes JS or CSS if you actually write some.

**ArcMoon code runs in two places:**

1. **Build-time code**: written in `${ }$`, runs in Node.js once each time you build the site, and only its output is written into the HTML.

```js
${ const title = "Hello ArcMoon"; }$
${ const secretKey = "sk-live-123"; }$
[h1]${ title }$[end]
```

The HTML it builds:

```html
<h1>Hello ArcMoon</h1>
```

Only `title` was printed. `secretKey` was declared but never output, so it isn't in the page.

2. **Browser code**: written in `runtime ${ }$`, runs on the visitor's device every time they open the page.

```js
runtime ${
  import { signal } from "arcmoon/reactive";
  const count = signal(0);
}$
[button = onclick: runtime ${ () => count(count() + 1) }$]Clicked runtime ${ count() }$ times[end]
```

Each visitor gets their own `count`, and the button updates it in their browser.

Because the code itself never leaves your build, secrets and database queries are safe in build-time code, as long as you don't output them into the page.

```js
${
  const secretKey = "sk-live-123";
  const posts = [                  // imagine a database query here
    { title: "Hello ArcMoon", draft: false },
    { title: "Secret plan", draft: true }
  ];
  const published = posts.filter(p => !p.draft);
}$

[ul]
  [for-each = ${ published }$, as: "post"]
    [li]${ post.title }$[end]
  [end]
[end]
```

The HTML it builds:

```html
<ul>
  <li>Hello ArcMoon</li>
</ul>
```
The key, the draft post and the filtering code stay in your build. The exception is anything you print. Adding `[p]${ secretKey }$[end]` would put the key in the page for everyone to read.

### Requirements

- [Node.js](https://nodejs.org) 22.12 or newer (check with `node -v`).
- npm, pnpm, bun or yarn.

## Installation

Install the `arcm` command:

```bash
npm install -g arcmoon
```

Check that it works

```bash
arcm -v
```

This prints the installed version. `arcm` is the short name for `arcmoon`, and they are the same command, so this works too:

```bash
arcmoon -v
```

To keep ArcMoon inside one project instead, run `npm install arcmoon` there and use `npx arcm`.

## A template language you enjoy building with

```ini
# count is a signal. Clicking the button changes it, and the text updates by itself.
runtime ${
  import { signal } from "arcmoon/reactive";
  const count = signal(0);
}$

[button = onclick: runtime ${ () => count(count() + 1) }$]
  Clicked runtime ${ count() }$ times
[end:button]
```

Read the [docs](https://adam-elmi.github.io/ArcMoon-Site/docs/), or [try it in the playground](https://adam-elmi.github.io/ArcMoon-Site/playground.html) without installing anything.

## License

MIT © Adam Elmi

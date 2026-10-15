<p align="center">
  <img src="assets/arcmoon-logo.svg" alt="ArcMoon logo" width="120">
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

ArcMoon is a template language for web pages. You write `.arcm` files, and ArcMoon builds them into plain HTML, with only the CSS and JavaScript each page needs. Code that runs while the page is built and code that runs in the browser are kept apart, so secrets and database queries never reach your visitors.

### Requirements

- [Node.js](https://nodejs.org) 22.12 or newer (check with `node -v`).
- npm, pnpm, bun or yarn.

## Installation

Install the `arcm` command:

```bash
npm install -g arcmoon
```

Check that it works:

```bash
arcm -v
```

`arcmoon` and its short name `arcm` are the same command. To keep ArcMoon inside one project instead, run `npm install arcmoon` there and use `npx arcm`.

## A template language you enjoy building with

```ini
# A signal holds the count: the button changes it, the text follows
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

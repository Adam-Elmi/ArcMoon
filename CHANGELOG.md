# Changelog

All notable changes to ArcMoon. From 1.0.0, ArcMoon follows [semver](https://semver.org): what works in 1.0 keeps working in every 1.x.

## 1.1.0 — 2026-10-22

### New features

#### Live loops
A `[for-each]` whose list is `runtime ${ }$` keeps its rows in step with the list in the browser.
```ini
runtime ${
  import { signal } from "arcmoon/reactive";
  const todos = signal([{ id: 1, title: "Read a book" }]);
  const remove = (id) => todos(todos().filter((t) => t.id !== id));
}$

[ul]
  [for-each = runtime ${ todos() }$, as: "todo", key: "id"]
    [li]runtime ${ todo.title }$ [button = onclick: runtime ${ () => remove(todo.id) }$]Delete[end][end]
  [end]
[end]
```
- No DOM code: set the signal, and the list updates.
- With `key`, rows stay with their items, so an input keeps its focus while others are added or removed.

#### The first rows of a live loop are in the HTML
When the list starts as a literal or an exported value, ArcMoon writes its first rows at build time, and the browser adopts them.
```ini
runtime ${
  import { signal } from "arcmoon/reactive";
  const names = signal(["Cali", "Maryan"]);
}$

[ul][for-each = runtime ${ names() }$, as: "name"][li]runtime ${ i + 1 }$. runtime ${ name }$[end][end][end]
```
```html
<ul><li>1. Cali</li><li>2. Maryan</li> …</ul>   <!-- already in the page, before any script runs -->
```
- No empty list or jump while the script loads.
- Search engines and visitors without JavaScript see the rows.

#### await in runtime code
A runtime block can wait for data at its top level.
```ini
runtime ${
  import { signal } from "arcmoon/reactive";
  const books = signal(await (await fetch("/books.json")).json());
}$

[ul][for-each = runtime ${ books() }$, as: "book", key: "id"][li]runtime ${ book.title }$[end][end][end]
```
- Load data or a module in one line, without an async wrapper.
- Live values and events attach once the data is there.

#### Imports from a URL
Runtime code can import a module straight from a CDN; the browser loads it.
```ini
runtime ${ import confetti from "https://esm.sh/canvas-confetti@1"; }$
[button = onclick: runtime ${ () => confetti() }$]Party[end]
```
- No `npm install`, no `bundle` entry.
- `packages` in the config gives a short name to a URL: `packages: { dayjs: "https://esm.sh/dayjs@1" }`, then `import dayjs from "dayjs"`.

### Improvements

#### New warnings
ArcMoon now warns about easy mistakes that used to fail quietly in the browser.
```
⚠ "count" is a signal; read it with count()
⚠ [img] can't have content (<img> is a void element); write [img = … !]
⚠ arcm-rwa is not an ArcMoon directive, so it does nothing (did you mean arcm-raw?)
⚠ [for-each] needs a list, but got an object, so it shows nothing
⚠ the page has non-ASCII text (like "×") but no <meta charset="utf-8">
```
- You see the mistake when you build, with the fix in the message.
- Also: `[doctype!]` after content, props on `[slot]`, unknown props on `[for-each]`, and a name only another file's runtime code declares.

#### Smaller pages
A page whose only live values are events no longer ships the signals library.
```ini
[button = onclick: runtime ${ () => alert("Hi") }$]Say hi[end]
```
- That page's script is 2 kB instead of 5 kB.

### Bugs fixed
- `[A]` is written as `<a>`.
- `base: "/"` with `-o dist/blog` links to `/blog/assets/…`.
- The `[doctype]` error shows its file and line.
- The protector shows the full path of a template outside the project.

## 1.0.0 — 2026-10-15

The first stable release of ArcMoon.

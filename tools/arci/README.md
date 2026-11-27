# Arci

Arci turns SVG icon files into reusable ArcMoon components.

## Setup

Install Arci in your project:

```sh
npm install --save-dev @adam-elmi/arci
```

Arci builds `.arcm` component files in `./arcmoon-icons`, so you can use those icons as ArcMoon components. Add this alias to the project's `arcmoon.config.js` so ArcMoon can find them:

```js
export default {
	importAliases: {
		"@icons": "./arcmoon-icons"
	}
};
```

Keep any other settings already in your config. ArcMoon reads this file from the directory where you run `arcm`.

## Use Arci's built-in Lucide icons

Add a Lucide alias to `importAliases` in `arcmoon.config.js`:

```js
export default {
	importAliases: {
		"@lucide": "./node_modules/@adam-elmi/arci/icons/lucide"
	}
};
```

If you already have `importAliases`, add `@lucide` to it without removing your other aliases. Then import and use an icon:

```ini
[import = ArrowLeft: "@lucide/arrow-left.arcm" !]
[ArrowLeft = width: 30, height: 30, color: "purple" !]
```

On first use, review and trust the imported package template with `arcm trust <dir>`.

The bundled icons come from `lucide-static` 1.82.0. See [LICENSE.md](LICENSE.md) for the license terms.

## Use an icon component

Each icon component renders an SVG element. Pass ArcMoon props directly to that SVG, including SVG attributes such as `width` and `color`, the `style` prop, or `css.*` properties:

```ini
[button = type: "button"]
  [ArrowLeft = width: 20, height: 20, color: "purple", style: "margin-right: 8px", css.background-color: "#f3e8ff" !]
  Go back
[end]
```

## Convert another icon package

Install an npm package that contains SVG files, then build its icons:

```sh
npm install lucide-static
npx arci build lucide-static
```

Arci writes components to `./arcmoon-icons/lucide-static`. Import an icon using the `@icons` alias:

```ini
[import = ArrowLeft: "@icons/lucide-static/arrow-left.arcm" !]
[ArrowLeft = width: 30, height: 30, color: "purple" !]
```

Arci automatically looks for SVGs in the package's `icons`, `svg`, or `svgs` folder. If they are somewhere else, pass that folder's path relative to the installed package:

```sh
npx arci build @fortawesome/fontawesome-free --svg-dir svgs/solid
```

This converts only the SVGs in `node_modules/@fortawesome/fontawesome-free/svgs/solid`. You can also change the output folder with `--out DIR`.

## Other ready-to-use icon collections

Install only the collection you want; these do not need `arci build`:

```sh
npm install arci-icons-tabler
npm install arci-icons-fontawesome-free
```

```ini
[import = OutlineHome: "arci-icons-tabler/icons/outline/home.arcm" !]
[import = House: "arci-icons-fontawesome-free/icons/house.arcm" !]
```

**Licenses:** 

- [Arci MIT](LICENSE-ARCI)

- [Lucide ISC](icons/lucide/LICENSE)

- [Tabler MIT](https://github.com/tabler/tabler-icons/blob/main/LICENSE)

- [Font Awesome Free](https://fontawesome.com/license/free)

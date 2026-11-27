# Arci Tabler Icons

6,563 prebuilt outline and filled ArcMoon icon components from `@tabler/icons` 3.53.0.

## Setup

Install the collection in your ArcMoon project:

```sh
npm install arci-icons-tabler
```

Add an alias to `importAliases` in `arcmoon.config.js`:

```js
export default {
	importAliases: {
		"@tabler-icons": "./node_modules/arci-icons-tabler/icons"
	}
};
```

If you already have `importAliases`, add this entry without removing your other aliases.

## Use an icon

Import the component and pass SVG attributes or ArcMoon styling props:

```ini
[import = OutlineHome: "@tabler-icons/outline/home.arcm" !]
[OutlineHome = width: 28, height: 28, color: "rebeccapurple", css.background-color: "#f3e8ff" !]
```

On first use, review and trust the package template with `arcm trust <dir>`.

License: [Tabler MIT](https://github.com/tabler/tabler-icons/blob/main/LICENSE). The package also includes Arci's MIT notice in `LICENSE-ARCI`.

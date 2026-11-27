# Arci Font Awesome Free Icons

2,001 prebuilt Font Awesome Free solid icons as ArcMoon components, from version 7.3.1.

## Setup

Install the collection in your ArcMoon project:

```sh
npm install arci-icons-fontawesome-free
```

Add an alias to `importAliases` in `arcmoon.config.js`:

```js
export default {
	importAliases: {
		"@fontawesome": "./node_modules/arci-icons-fontawesome-free/icons"
	}
};
```

If you already have `importAliases`, add this entry without removing your other aliases.

## Use an icon

Import the component and pass SVG attributes or ArcMoon styling props:

```ini
[import = House: "@fontawesome/house.arcm" !]
[House = width: 28, height: 28, color: "rebeccapurple", style: "margin-right: 8px" !]
```

On first use, review and trust the package template with `arcm trust <dir>`.

License: [Font Awesome Free](https://fontawesome.com/license/free). Arci's own MIT notice is included in `LICENSE-ARCI`.

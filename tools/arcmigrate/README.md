# ArcMigrate

Convert an HTML project into ArcMoon files while keeping its existing assets.

## Setup

Install ArcMigrate in your project:

```sh
npm install --save-dev arcmigrate
```

## Migrate a project

```sh
npx arcmigrate ./old-site ./arcmoon-site
```

The output directory must be outside the input directory.

- `.html` and `.htm` files become `.arcm` files with the same relative paths.
- Other files, including CSS, JavaScript, images, and fonts, are copied unchanged.
- Inline `<style>` and `<script>` content is preserved in the `.arcm` file.

For example, `old-site/index.html` becomes `arcmoon-site/index.arcm`, and `old-site/assets/site.css` is copied to `arcmoon-site/assets/site.css`.

ArcMigrate converts HTML structure; it does not redesign pages or translate framework-specific templates. Malformed HTML is parsed using browser-style recovery and reported as a warning.

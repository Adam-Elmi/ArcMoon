# ArcMoon showcase

Real projects built with ArcMoon. Every page is a `.arcm` file.

```bash
npm install --ignore-scripts
npm run build      # arcm build pages → dist/
npm run serve      # http://localhost:4400
```

| Folder | What's in it |
| --- | --- |
| `pages/` | one page per showcase, plus the home page |
| `src/layouts/Showcase.arcm` | the frame: header (logo, showcase info, prev / next), footer (ArcMoon version), light / dark |
| `src/data/showcases.json` | the list of showcases; `ready: true` puts one in prev / next |
| `src/components/` | small parts shared by pages |
| `src/snake/` | Snake's components (stats, keys, arrow buttons) |
| `src/styles/site.css` | colors, type and the page frame |

Adding a showcase: write `pages/<slug>.arcm` wrapped in `[Showcase = slug: "<slug>"]`, and set `ready: true` for it in `showcases.json`.

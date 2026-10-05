// ###################
// ArcMoon config for the showcase site
// ###################
export default {
	importAliases: { "@": "./src" },   // [import = X: "@/components/X.arcm" !]
	bundle: ["canvas-confetti"],       // npm packages allowed in runtime code
	outDir: "./dist",                  // "arcm build pages" writes here
	timeout: 30000,                    // ms per page; the country explorer fetches over the network
	externalScripts: false,            // JS inside each page, so dist/ also works opened from disk (file://)
	externalStyles: true               // CSS in dist/assets/, shared between pages
};

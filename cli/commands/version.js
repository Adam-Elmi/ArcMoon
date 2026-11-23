// ###################
// -v and the header
// ###################

import pkg from "../../package.json" with { type: "json" };

export const printVersion = () => console.log(pkg.version);

export const printHeader = () => {
	console.log([
		`ArcMoon-${pkg.version} Copyright (C) Adam Elmi`,
		"ArcMoon is a template language that compiles to web pages.",
		"Run \"arcmoon --help\" for commands."
	].join("\n"));
};

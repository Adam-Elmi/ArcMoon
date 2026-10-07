// ###################
// ArcMoon's tests only; packages in tools/ run their own
// ###################
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: { exclude: [...configDefaults.exclude, "tools/**"] }
});

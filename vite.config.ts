// Build settings for `cf build` / `cf dev`. Worker settings and bindings live in cloudflare.config.ts.
// The player page is built by `npm run build` (tools/build.ts, esbuild) into out/site/index.html. Vite copies
// that directory into the Worker's static assets, so run `npm run build` before `cf build`, `cf dev` or `cf deploy`
// (the deploy and worker:* scripts do).
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [cloudflare()],
	publicDir: "out/site",
});

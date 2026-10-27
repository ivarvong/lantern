// The lantern Worker at lantern.ivar.workers.dev: the explainers as an API (app/worker.ts) plus the player page as a
// static asset. `cf build`, `cf dev`, `cf deploy` and `cf workers types` read this file. vite.config.ts holds the
// build settings, including where the built player page comes from.
import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		// The Worker already exists on the account. Renaming it here creates a second Worker.
		name: "lantern",
		// The date the live Worker already runs on.
		compatibilityDate: "2025-06-01",
		entrypoint: "app/worker.ts",
		// Both match the live Worker: lantern.ivar.workers.dev, and per-version preview URLs on.
		// cf's default for previewUrls is false, so leaving it out would turn preview URLs off.
		workersDev: true,
		previewUrls: true,
		// "/" runs the Worker first: it serves the page to browsers and /llms.txt text to everyone else.
		// Every other asset path is served without invoking the Worker.
		assets: { runWorkerFirst: ["/"] },
		env: {
			ASSETS: bindings.assets(),
		},
	},
});

import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://krisyang.dev",
  output: "static",
  compressHTML: true,
  build: {
    inlineStylesheets: "auto",
  },
});

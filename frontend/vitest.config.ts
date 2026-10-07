import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // Bundle svg2pdf.js from its ES build, as the app does; its UMD build
    // cannot find jsPDF when Node loads it.
    server: { deps: { inline: ["svg2pdf.js"] } },
  },
});

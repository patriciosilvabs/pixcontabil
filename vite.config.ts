import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import fs from "fs";

function bumpVersionPlugin(): Plugin {
  return {
    name: "bump-version",
    buildStart() {
      const versionFile = path.resolve(__dirname, "version.json");
      const raw = fs.readFileSync(versionFile, "utf8");
      const data = JSON.parse(raw);
      const parts = data.version.split(".").map(Number);
      const oldVersion = data.version;
      parts[1] += 1;
      data.version = parts.join(".");
      fs.writeFileSync(versionFile, JSON.stringify(data, null, 2) + "\n");
      console.log(`[bump-version] v${oldVersion} → v${data.version}`);
    },
  };
}

const versionData = JSON.parse(fs.readFileSync(path.resolve(__dirname, "version.json"), "utf8"));

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(`v${versionData.version}`),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __BUILD_HASH__: JSON.stringify(Date.now().toString(36)),
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode === "production" && bumpVersionPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
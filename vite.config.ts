import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import fs from "fs";

const versionFilePath = path.resolve(__dirname, "version.json");

function readVersion() {
  const raw = fs.readFileSync(versionFilePath, "utf8");
  const data = JSON.parse(raw) as { version?: string };

  if (!data.version) {
    throw new Error("[version] version.json sem o campo version");
  }

  return data.version;
}

function getNextVersion(version: string) {
  const parts = version.split(".").map(Number);

  if (parts.length !== 2 || parts.some(Number.isNaN)) {
    throw new Error(`[version] formato inválido: ${version}`);
  }

  parts[1] += 1;
  return parts.join(".");
}

function bumpVersionPlugin(): Plugin {
  return {
    name: "bump-version",
    buildStart() {
      const currentVersion = readVersion();
      const nextVersion = getNextVersion(currentVersion);

      fs.writeFileSync(versionFilePath, JSON.stringify({ version: nextVersion }, null, 2) + "\n");
      console.log(`[bump-version] v${currentVersion} → v${nextVersion}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const currentVersion = readVersion();
  const resolvedVersion = mode === "production" ? getNextVersion(currentVersion) : currentVersion;

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(`v${resolvedVersion}`),
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
  };
});
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import fs from "fs";

const versionFilePath = path.resolve(__dirname, "version.json");
const distAssetsPath = path.resolve(__dirname, "dist", "assets");

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

function validateVersionPlugin(version: string): Plugin {
  return {
    name: "validate-version",
    closeBundle() {
      if (!fs.existsSync(distAssetsPath)) {
        throw new Error("[validate-version] ERRO CRÍTICO: diretório dist/assets não encontrado!");
      }

      const versionString = `v${version}`;
      const jsFiles = fs.readdirSync(distAssetsPath).filter((file) => file.endsWith(".js"));
      const found = jsFiles.some((file) =>
        fs.readFileSync(path.join(distAssetsPath, file), "utf8").includes(versionString),
      );

      if (!found) {
        throw new Error(`[validate-version] ERRO CRÍTICO: \"${versionString}\" não encontrada no bundle dist/assets!`);
      }

      console.log(`[validate-version] ✅ Build válido — ${versionString} confirmada no bundle`);
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const shouldBumpVersion = command === "build" && mode === "production";
  const currentVersion = readVersion();
  const resolvedVersion = shouldBumpVersion ? getNextVersion(currentVersion) : currentVersion;

  if (shouldBumpVersion) {
    fs.writeFileSync(versionFilePath, JSON.stringify({ version: resolvedVersion }, null, 2) + "\n");
    console.log(`[bump-version] v${currentVersion} → v${resolvedVersion}`);
  }

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
      shouldBumpVersion && validateVersionPlugin(resolvedVersion),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
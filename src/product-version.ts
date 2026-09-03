import { readFileSync } from "node:fs";

type ProductManifest = Readonly<{
  name?: unknown;
  version?: unknown;
}>;

function readProductVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as ProductManifest;
  if (manifest.name !== "harness-config-studio" || typeof manifest.version !== "string") {
    throw new Error("The package manifest does not contain a valid Harness Config Studio version.");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error("The package manifest version is not valid SemVer.");
  }
  return manifest.version;
}

export const PRODUCT_VERSION = readProductVersion();

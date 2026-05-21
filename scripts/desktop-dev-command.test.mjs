import assert from "node:assert/strict";
import fs from "node:fs";

const rootPackage = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const desktopPackage = JSON.parse(
  fs.readFileSync(new URL("../apps/desktop/package.json", import.meta.url), "utf8"),
);

assert.match(
  rootPackage.scripts["desktop:dev"],
  /tauri:dev/,
  "desktop:dev should launch the Tauri desktop app instead of only starting Vite",
);

assert.match(
  desktopPackage.scripts["tauri:dev"] ?? "",
  /tauri dev/,
  "desktop workspace should expose a tauri:dev script that opens the desktop app",
);

console.log("desktop dev command checks passed");

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const templatePath = path.join(
  repoRoot,
  "apps",
  "desktop",
  "src-tauri",
  "windows",
  "main.wxs",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const source = fs.readFileSync(templatePath, "utf8");

assert(
  source.includes('InstallScope="perUser"'),
  "expected custom WiX template to use per-user install scope",
);
assert(
  source.includes('Directory Id="LocalAppDataFolder"'),
  "expected custom WiX template to install under LocalAppDataFolder",
);
assert(
  source.includes('RegistrySearch Id="PrevInstallDirWithName"'),
  "expected custom WiX template to keep the named InstallDir search",
);
assert(
  !source.includes('RegistrySearch Id="PrevInstallDirNoName"'),
  "expected custom WiX template to ignore the unnamed NSIS registry value",
);
assert(
  !source.includes('Root="HKLM" Key="Software\\\\Classes\\\\{{protocol}}"'),
  "expected deep link registration to avoid HKLM in per-user MSI mode",
);
assert(
  source.includes('Root="HKCU" Key="Software\\\\Classes\\\\{{protocol}}"'),
  "expected deep link registration to use HKCU in per-user MSI mode",
);

console.log(`wix template checks passed for ${path.relative(repoRoot, templatePath)}`);

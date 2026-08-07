#!/usr/bin/env node
/**
 * Bump package / sidebar version (default: patch).
 * Env: VERSION_BUMP=patch|minor|major
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
const appVersionPath = path.join(root, "lib", "app-version.js");

const bumpKind = String(process.env.VERSION_BUMP || "patch").toLowerCase();

function nextVersion(current, kind) {
  const parts = String(current || "0.0.0")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  let [major, minor, patch] = parts;

  if (kind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const previous = pkg.version;
const next = nextVersion(previous, bumpKind);

pkg.version = next;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.version = next;
  if (lock.packages && lock.packages[""]) {
    lock.packages[""].version = next;
  }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

const banner =
  "/** Application release version - auto-bumped on git commit. */\n" +
  `export const APP_VERSION = "${next}";\n`;
fs.writeFileSync(appVersionPath, banner, "utf8");

console.log(`[version] ${previous} → ${next} (${bumpKind})`);

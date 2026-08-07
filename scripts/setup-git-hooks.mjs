#!/usr/bin/env node
/**
 * Point this repo at .githooks/ so pre-commit version bumps run locally.
 * Safe no-op outside a git work tree (e.g. some CI checkouts).
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = path.join(root, ".githooks");
const preCommit = path.join(hooksDir, "pre-commit");

try {
  execSync("git rev-parse --is-inside-work-tree", {
    cwd: root,
    stdio: "ignore",
  });
} catch {
  process.exit(0);
}

if (!fs.existsSync(preCommit)) {
  console.warn("[hooks] .githooks/pre-commit missing — skip");
  process.exit(0);
}

try {
  execSync("git config core.hooksPath .githooks", { cwd: root, stdio: "ignore" });
  // Best-effort executable bit for macOS/Linux clones
  try {
    fs.chmodSync(preCommit, 0o755);
  } catch {
    /* Windows may ignore mode */
  }
  console.log("[hooks] core.hooksPath → .githooks (version bump on commit)");
} catch (err) {
  console.warn("[hooks] could not set core.hooksPath:", err.message);
}

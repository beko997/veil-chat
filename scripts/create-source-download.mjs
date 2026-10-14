import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const archiveRelativePath =
  "artifacts/veil-chat/public/downloads/veil-chat-source.zip";
const archivePath = path.join(workspaceRoot, archiveRelativePath);

await mkdir(path.dirname(archivePath), { recursive: true });
await rm(archivePath, { force: true });

execFileSync(
  "zip",
  [
    "-q",
    "-r",
    archiveRelativePath,
    "artifacts",
    "lib",
    "scripts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "tsconfig.json",
    "replit.md",
    "-x",
    "*/node_modules/*",
    "*/dist/*",
    "*/.replit-artifact/*",
    "*/.tsbuildinfo",
    archiveRelativePath,
  ],
  { cwd: workspaceRoot, stdio: "inherit" },
);

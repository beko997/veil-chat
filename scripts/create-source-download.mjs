import { zipSync } from "fflate";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const archivePath = path.join(
  workspaceRoot,
  "artifacts/veil-chat/public/downloads/veil-chat-source.zip",
);
const archivePrefix = "veil-chat/";

const rootFiles = [
  ".env.example",
  ".dockerignore",
  ".gitignore",
  ".npmrc",
  "Dockerfile",
  "README.md",
  "docker-compose.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
];
const sourceDirectories = ["artifacts", "lib", "scripts"];
const ignoredDirectories = new Set([
  ".cache",
  ".expo",
  ".git",
  ".local",
  ".pnpm-store",
  ".replit-artifact",
  "coverage",
  "dist",
  "node_modules",
]);
const ignoredFiles = new Set([".DS_Store", "Thumbs.db"]);

function shouldIncludeFile(relativePath) {
  const name = path.basename(relativePath);
  if (ignoredFiles.has(name)) return false;
  if (name === ".env") return false;
  if (name.startsWith(".env.") && name !== ".env.example") return false;
  if (name.endsWith(".tsbuildinfo") || name.endsWith(".log")) return false;
  if (relativePath === "artifacts/veil-chat/public/downloads/veil-chat-source.zip") {
    return false;
  }
  return true;
}

async function collectDirectory(directory, relativeDirectory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink() || ignoredDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      await collectDirectory(absolutePath, relativePath, files);
      continue;
    }
    if (!entry.isFile() || !shouldIncludeFile(relativePath)) continue;

    files[`${archivePrefix}${relativePath}`] = await readFile(absolutePath);
  }
}

async function createArchive() {
  const files = {};

  for (const filename of rootFiles) {
    const absolutePath = path.join(workspaceRoot, filename);
    files[`${archivePrefix}${filename}`] = await readFile(absolutePath);
  }

  for (const directory of sourceDirectories) {
    const absolutePath = path.join(workspaceRoot, directory);
    await collectDirectory(absolutePath, directory, files);
  }

  const zipped = zipSync(files, { level: 8 });
  await mkdir(path.dirname(archivePath), { recursive: true });
  await writeFile(archivePath, zipped);
  console.log(
    `Portable Veil Chat source archive created (${Object.keys(files).length} files).`,
  );
}

createArchive().catch((error) => {
  console.error("Could not create the Veil Chat source download:", error);
  process.exitCode = 1;
});

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(rootDir, ".env");

function parseEnv(contents) {
  const result = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

let fileEnv;
try {
  fileEnv = parseEnv(await readFile(envFile, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  console.error("`.env` bulunamadı. Önce `.env.example` dosyasını `.env` olarak kopyalayın.");
  process.exit(1);
}

const apiPort = process.env.PORT ?? fileEnv.PORT ?? "3001";
const webPort = process.env.VITE_PORT ?? fileEnv.VITE_PORT ?? "5173";
const apiUrl =
  process.env.VITE_API_BASE_URL ??
  fileEnv.VITE_API_BASE_URL ??
  `http://127.0.0.1:${apiPort}`;
const sharedEnv = {
  ...fileEnv,
  ...process.env,
  PORT: apiPort,
  VITE_PORT: webPort,
  VITE_API_BASE_URL: apiUrl,
};

if (!sharedEnv.DATABASE_URL) {
  console.error("`.env` içinde DATABASE_URL tanımlanmalı.");
  process.exit(1);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const spawnOptions = {
  cwd: rootDir,
  env: sharedEnv,
  stdio: "inherit",
  shell: process.platform === "win32",
};

function runPnpm(args, env = sharedEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, args, { ...spawnOptions, env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm ${args.join(" ")} başarısız oldu (${signal ?? code}).`));
    });
  });
}

console.log("Veritabanı şeması uygulanıyor…");
await runPnpm(["--filter", "@workspace/db", "run", "push"]);

const apiEnv = { ...sharedEnv, PORT: apiPort, NODE_ENV: "development" };
console.log("API derleniyor…");
await runPnpm(["--filter", "@workspace/api-server", "run", "build"], apiEnv);

const children = new Set();
let stopping = false;

function stopChildren(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

function start(label, args, env) {
  const child = spawn(pnpm, args, { ...spawnOptions, env });
  children.add(child);
  child.once("error", (error) => {
    console.error(`${label} başlatılamadı:`, error.message);
    stopChildren();
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping) {
      if (code !== 0) process.exitCode = code ?? 1;
      stopChildren();
    }
  });
  return child;
}

start("API", ["--filter", "@workspace/api-server", "run", "start"], apiEnv);
start(
  "Web",
  ["--filter", "@workspace/veil-chat", "run", "dev"],
  { ...sharedEnv, VITE_PORT: webPort, VITE_API_BASE_URL: apiUrl },
);

console.log(`Veil Chat açılıyor: http://localhost:${webPort}`);
console.log("Durdurmak için Ctrl+C tuşlarına basın.");

process.on("SIGINT", () => stopChildren("SIGINT"));
process.on("SIGTERM", () => stopChildren("SIGTERM"));

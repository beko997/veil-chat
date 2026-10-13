import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const apiDirectory = path.join(workspaceRoot, "artifacts/api-server");

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code ?? "unknown"}.`));
    });
  });
}

await run("pnpm", ["--filter", "@workspace/db", "run", "push"], {
  cwd: workspaceRoot,
  env: process.env,
});

const server = spawn(
  process.execPath,
  ["--enable-source-maps", "./dist/index.mjs"],
  {
    cwd: apiDirectory,
    env: process.env,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.once("error", (error) => {
  console.error("Could not start the Veil Chat API server:", error);
  process.exitCode = 1;
});
server.once("close", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

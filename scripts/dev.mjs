// One-command start: installs dependencies if missing, then runs Next.js.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

if (!existsSync(join(root, "node_modules", "next", "package.json"))) {
  console.log("\n[ELANO] First run: installing dependencies (a few minutes)...\n");
  const install = spawnSync("npm install", { stdio: "inherit", shell: true });
  if (install.status !== 0) {
    console.error("\n[ELANO] npm install failed. Check your internet connection and run again.");
    process.exit(install.status ?? 1);
  }
}

if (!existsSync(join(root, ".env.local"))) {
  console.warn("\n[ELANO] Warning: .env.local not found. Firebase will not connect.\n");
}

const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const run = spawnSync(process.execPath, [nextBin, "dev"], { stdio: "inherit" });
process.exit(run.status ?? 0);

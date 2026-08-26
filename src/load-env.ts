import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export function getProjectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadProjectEnv(): void {
  const root = getProjectRoot();
  const production = path.join(root, ".env.production");
  const local = path.join(root, ".env");
  dotenv.config({
    path: existsSync(production) ? production : local,
    override: true,
  });
}

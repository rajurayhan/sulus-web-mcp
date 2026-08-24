import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function getProjectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadProjectEnv(): void {
  dotenv.config({
    path: path.join(getProjectRoot(), ".env"),
    override: true,
  });
}

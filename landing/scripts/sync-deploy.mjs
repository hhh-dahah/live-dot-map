import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const landingDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(landingDir, "..");
const outDir = path.join(landingDir, "out");
const deployDir = path.join(rootDir, ".deploy");

await mkdir(deployDir, { recursive: true });
await cp(outDir, deployDir, { recursive: true, force: true });

const stalePages = [path.join(deployDir, "index.html.bak")];
for (const stalePage of stalePages) {
  await rm(stalePage, { force: true });
}

console.log(`Synced ${outDir} -> ${deployDir}`);

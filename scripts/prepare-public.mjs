import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "public");

await mkdir(output, { recursive: true });

const files = [
  ["index.html", "pocket.html"],
  ["app.js", "app.js"],
  ["styles.css", "styles.css"],
  ["asset-styles.css", "asset-styles.css"],
  ["mobile-fixes.css", "mobile-fixes.css"]
];

await Promise.all(
  files.map(([source, target]) =>
    copyFile(resolve(root, source), resolve(output, target))
  )
);

import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "public");

await mkdir(output, { recursive: true });
await mkdir(resolve(output, "vendor"), { recursive: true });

const files = [
  ["index.html", "pocket.html"],
  ["app.js", "app.js"],
  ["styles.css", "styles.css"],
  ["asset-styles.css", "asset-styles.css"],
  ["mobile-fixes.css", "mobile-fixes.css"]
  ,["cloud-styles.css", "cloud-styles.css"]
  ,["cloud-sync.js", "cloud-sync.js"]
  ,["node_modules/@supabase/supabase-js/dist/umd/supabase.js", "vendor/supabase.js"]
];

await Promise.all(
  files.map(([source, target]) =>
    copyFile(resolve(root, source), resolve(output, target))
  )
);

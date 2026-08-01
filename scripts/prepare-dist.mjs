import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const source = resolve(root, "public");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await cp(resolve(output, "pocket.html"), resolve(output, "index.html"));

await mkdir(resolve(output, "server"), { recursive: true });
await mkdir(resolve(output, ".openai"), { recursive: true });

const embeddedFiles = {};
for (const file of [
  "index.html",
  "app.js",
  "styles.css",
  "asset-styles.css",
  "mobile-fixes.css"
]) {
  embeddedFiles[`/${file}`] = await readFile(resolve(output, file), "utf8");
}

await writeFile(
  resolve(output, "server", "index.js"),
  `const files = ${JSON.stringify(embeddedFiles)};
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const body = files[path];
    if (body === undefined) {
      return new Response("Not Found", { status: 404 });
    }
    const extension = path.slice(path.lastIndexOf("."));
    return new Response(body, {
      headers: {
        "content-type": contentTypes[extension] || "text/plain; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0"
      }
    });
  }
};
`,
  "utf8"
);

await cp(
  resolve(root, ".openai", "hosting.json"),
  resolve(output, ".openai", "hosting.json")
);

// Serves a built frontend (default: dist/) for the end-to-end tests.
// E2E_DIST points it at another build, e.g. one of main, to compare.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.E2E_DIST ?? "dist");
const port = Number(process.env.E2E_PORT ?? 4173);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(root, "index.html");
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}`));

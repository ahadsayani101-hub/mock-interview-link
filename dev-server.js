// Local dev: `npm run dev` serves public/ and the api/ routes the same way Vercel does.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const port = process.env.PORT || 3000;

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/")) {
      try {
        const mod = await import(`./api/${url.pathname.slice(5).replace(/[^a-z]/g, "")}.js`);
        return mod.default(req, res);
      } catch {
        res.statusCode = 404;
        return res.end("Not found");
      }
    }
    let path = url.pathname === "/" || /^\/i(\/|$)/.test(url.pathname) ? "/index.html" : url.pathname;
    if (!extname(path)) path += ".html";
    try {
      const body = await readFile(join("public", normalize(path).replace(/^(\.\.[/\\])+/, "")));
      res.setHeader("Content-Type", types[extname(path)] || "application/octet-stream");
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  })
  .listen(port, () => console.log(`http://localhost:${port}`));

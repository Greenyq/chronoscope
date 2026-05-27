import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addEvent, createTrace, finishTrace, getReplay, listReplays } from "./store.js";
import { runScenario } from "./scenario.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const port = Number(process.env.PORT ?? 4177);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/replays") {
      return json(res, 200, { replays: listReplays() });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/replays/")) {
      const replayId = url.pathname.split("/").at(-1);
      const replay = getReplay(replayId);
      return replay ? json(res, 200, { replay }) : json(res, 404, { error: "Replay not found" });
    }

    if (req.method === "POST" && url.pathname === "/api/traces") {
      const body = await readJson(req);
      const trace = createTrace(body);
      return json(res, 201, { traceId: trace.traceId });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/traces\/[^/]+\/events$/)) {
      const traceId = url.pathname.split("/")[3];
      const event = addEvent(traceId, await readJson(req));
      return event ? json(res, 201, { event }) : json(res, 404, { error: "Trace not found" });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/traces\/[^/]+\/finish$/)) {
      const traceId = url.pathname.split("/")[3];
      const result = finishTrace(traceId, await readJson(req));
      return result ? json(res, 200, result) : json(res, 404, { error: "Trace not found" });
    }

    if (req.method === "POST" && url.pathname === "/api/demo") {
      const ok = await runScenario({ shouldFail: false });
      const failed = await runScenario({ shouldFail: true });
      return json(res, 200, { ok, failed, replays: listReplays() });
    }

    return staticFile(res, url.pathname);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "Internal server error", detail: error.message });
  }
});

server.listen(port, () => {
  console.log(`Chronoscope running at http://localhost:${port}`);
});

async function staticFile(res, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.join(publicDir, relativePath);

  if (!filePath.startsWith(publicDir)) {
    return json(res, 403, { error: "Forbidden" });
  }

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(content);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".html")) return "text/html";
  return "application/octet-stream";
}

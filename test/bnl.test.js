import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { runBnlProbe } from "../src/bnl.js";
import { listReplays, resetStore } from "../src/store.js";

test("healthy BNL snapshot is discarded", async () => {
  resetStore();
  const previousBaseUrl = process.env.BNL_API_BASE_URL;
  const server = http.createServer((req, res) => {
    if (req.url === "/api/chronoscope/snapshot") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", counts: { players: 1 }, warnings: [] }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  process.env.BNL_API_BASE_URL = `http://127.0.0.1:${port}/api`;

  try {
    const result = await runBnlProbe();

    assert.equal(result.persisted, false);
    assert.equal(listReplays().length, 0);
  } finally {
    process.env.BNL_API_BASE_URL = previousBaseUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});

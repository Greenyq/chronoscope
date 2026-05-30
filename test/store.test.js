import test from "node:test";
import assert from "node:assert/strict";
import { addEvent, createTrace, finishTrace, getReplay, listReplays, resetStore } from "../src/store.js";

test("successful traces are discarded", () => {
  resetStore();
  const trace = createTrace({ name: "success", service: "api" });
  addEvent(trace.traceId, { service: "api", message: "ok" });

  const result = finishTrace(trace.traceId, { failed: false, statusCode: 200 });

  assert.equal(result.persisted, false);
  assert.equal(listReplays().length, 0);
});

test("failed traces are persisted as replay sessions", () => {
  resetStore();
  const trace = createTrace({ name: "failure", service: "api" });
  addEvent(trace.traceId, {
    service: "worker",
    level: "error",
    type: "db.timeout",
    message: "DB timed out",
  });

  const result = finishTrace(trace.traceId, {
    failed: true,
    statusCode: 500,
    reason: "DB timeout",
  });

  const replays = listReplays();
  assert.equal(result.persisted, true);
  assert.equal(replays.length, 1);
  assert.equal(replays[0].reason, "DB timeout");
  assert.equal(replays[0].eventCount, 3);
  assert.equal(getReplay(replays[0].replayId).reason, "DB timeout");
});

test("sensitive event data is redacted", () => {
  resetStore();
  const trace = createTrace({ name: "redaction", service: "api" });
  addEvent(trace.traceId, {
    service: "api",
    message: "request",
    data: { token: "secret-token", nested: { password: "pw" } },
  });

  const result = finishTrace(trace.traceId, { failed: true, reason: "bad" });
  const event = result.replay.events.find((item) => item.message === "request");

  assert.equal(event.data.token, "[redacted]");
  assert.equal(event.data.nested.password, "[redacted]");
});

test("replay history is trimmed to the retention limit", () => {
  resetStore();

  for (let index = 0; index < 101; index += 1) {
    const trace = createTrace({ name: `failure-${index}`, service: "api" });
    finishTrace(trace.traceId, {
      failed: true,
      statusCode: 500,
      reason: `failure-${index}`,
    });
  }

  assert.equal(listReplays().length, 100);
});

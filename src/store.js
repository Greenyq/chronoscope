import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { analyzeReplay, summaryFromAnalysis } from "./analysis.js";

const activeTraces = new Map();

const MAX_REPLAYS = 100;
const databasePath = process.env.CHRONOSCOPE_DB_PATH ?? process.env.DATABASE_PATH ?? ":memory:";
const db = openDatabase(databasePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS replays (
    replay_id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    service TEXT NOT NULL,
    reason TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
`);

const insertReplay = db.prepare(`
  INSERT OR REPLACE INTO replays (
    replay_id,
    trace_id,
    name,
    service,
    reason,
    started_at,
    finished_at,
    duration_ms,
    payload
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const listReplayRows = db.prepare(`
  SELECT payload
  FROM replays
  ORDER BY datetime(finished_at) DESC
  LIMIT ?
`);

const getReplayRow = db.prepare(`
  SELECT payload
  FROM replays
  WHERE replay_id = ?
`);

const listReplayIdsAfterLimit = db.prepare(`
  SELECT replay_id
  FROM replays
  ORDER BY datetime(finished_at) DESC
  LIMIT -1 OFFSET ?
`);

const deleteReplay = db.prepare("DELETE FROM replays WHERE replay_id = ?");
const deleteAllReplays = db.prepare("DELETE FROM replays");

export function createTrace({ name, service, metadata = {} }) {
  const traceId = crypto.randomUUID();
  const startedAt = new Date();

  activeTraces.set(traceId, {
    traceId,
    name,
    service,
    metadata,
    startedAt: startedAt.toISOString(),
    events: [],
  });

  addEvent(traceId, {
    service,
    type: "trace.started",
    message: name,
    level: "info",
    data: metadata,
  });

  return activeTraces.get(traceId);
}

export function addEvent(traceId, event) {
  const trace = activeTraces.get(traceId);
  if (!trace) {
    return null;
  }

  const timestamp = new Date();
  const firstTimestamp = Date.parse(trace.startedAt);

  const fullEvent = {
    id: crypto.randomUUID(),
    timestamp: timestamp.toISOString(),
    offsetMs: timestamp.getTime() - firstTimestamp,
    service: event.service ?? trace.service,
    type: event.type ?? "event",
    level: event.level ?? "info",
    message: event.message ?? "",
    data: redact(event.data ?? {}),
  };

  trace.events.push(fullEvent);
  return fullEvent;
}

export function finishTrace(traceId, result) {
  const trace = activeTraces.get(traceId);
  if (!trace) {
    return null;
  }

  const failed = Boolean(result.failed || result.statusCode >= 500 || result.reason);
  const finishedAt = new Date();

  addEvent(traceId, {
    service: result.service ?? trace.service,
    type: failed ? "trace.failed" : "trace.succeeded",
    level: failed ? "error" : "info",
    message: failed ? result.reason ?? "Trace failed" : "Trace succeeded",
    data: result,
  });

  activeTraces.delete(traceId);

  if (!failed) {
    return { persisted: false, traceId };
  }

  const replay = {
    ...trace,
    replayId: `run_${traceId.slice(0, 8)}`,
    status: "failed",
    reason: result.reason ?? `HTTP ${result.statusCode}`,
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - Date.parse(trace.startedAt),
  };
  replay.analysis = analyzeReplay(replay, result);
  replay.metadata = { ...replay.metadata, analysis: replay.analysis };
  replay.summary = summaryFromAnalysis(replay, result, replay.analysis);

  persistReplay(replay);
  trimReplays();

  return { persisted: true, replay };
}

export function listReplays() {
  return listReplayRows.all(MAX_REPLAYS).map(({ payload }) => {
    const replay = JSON.parse(payload);

    return {
      replayId: replay.replayId,
      traceId: replay.traceId,
      name: replay.name,
      reason: replay.reason,
      service: replay.service,
      startedAt: replay.startedAt,
      finishedAt: replay.finishedAt,
      durationMs: replay.durationMs,
      eventCount: replay.events.length,
      summary: replay.summary,
      analysis: replay.analysis
        ? {
            incident: replay.analysis.incident,
            investigation: replay.analysis.investigation,
          }
        : undefined,
    };
  });
}

export function getReplay(replayId) {
  const row = getReplayRow.get(replayId);
  return row ? JSON.parse(row.payload) : null;
}

export function resetStore() {
  activeTraces.clear();
  deleteAllReplays.run();
}

function trimReplays() {
  for (const replay of listReplayIdsAfterLimit.all(MAX_REPLAYS)) {
    deleteReplay.run(replay.replay_id);
  }
}

function persistReplay(replay) {
  insertReplay.run(
    replay.replayId,
    replay.traceId,
    replay.name,
    replay.service,
    replay.reason,
    replay.startedAt,
    replay.finishedAt,
    replay.durationMs,
    JSON.stringify(replay),
  );
}

function openDatabase(filePath) {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }

  return new DatabaseSync(filePath);
}

function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const blocked = new Set(["password", "token", "authorization", "cookie", "secret"]);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      blocked.has(key.toLowerCase()) ? "[redacted]" : redact(item),
    ]),
  );
}

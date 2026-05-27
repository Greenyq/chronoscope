import crypto from "node:crypto";

const activeTraces = new Map();
const replays = new Map();

const MAX_REPLAYS = 100;

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
    summary: summarize(trace, result),
  };

  replays.set(replay.replayId, replay);
  trimReplays();

  return { persisted: true, replay };
}

export function listReplays() {
  return [...replays.values()]
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .map((replay) => ({
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
    }));
}

export function getReplay(replayId) {
  return replays.get(replayId) ?? null;
}

export function resetStore() {
  activeTraces.clear();
  replays.clear();
}

function trimReplays() {
  const ordered = listReplays();
  for (const replay of ordered.slice(MAX_REPLAYS)) {
    replays.delete(replay.replayId);
  }
}

function summarize(trace, result) {
  const services = [...new Set(trace.events.map((event) => event.service))];
  const errorEvent =
    trace.events.find((event) => event.level === "error" && event.type !== "trace.failed") ??
    trace.events.find((event) => event.level === "error");
  const slowestEvent = [...trace.events].sort((a, b) => b.offsetMs - a.offsetMs)[0];

  return {
    headline: result.reason ?? errorEvent?.message ?? "Trace failed",
    services,
    likelyCause: errorEvent
      ? `${errorEvent.service} emitted ${errorEvent.type}: ${errorEvent.message}`
      : "Failure was reported at trace finish without an explicit error event.",
    lastObservedStep: slowestEvent?.message ?? "No events captured.",
  };
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

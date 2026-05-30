import { addEvent, createTrace, finishTrace } from "./store.js";

const DEFAULT_TIMEOUT_MS = 5000;

export async function runBnlProbe() {
  const startedAt = Date.now();
  const baseUrl = normalizeBaseUrl(process.env.BNL_API_BASE_URL);
  const trace = createTrace({
    name: "BNL League integration probe",
    service: "chronoscope",
    metadata: {
      integration: "bnl-league",
      endpoint: baseUrl ? `${baseUrl}/chronoscope/snapshot` : null,
    },
  });

  addEvent(trace.traceId, {
    service: "chronoscope",
    type: "integration.probe.started",
    message: "Started BNL League snapshot probe",
    data: { configured: Boolean(baseUrl) },
  });

  if (!baseUrl) {
    return finishTrace(trace.traceId, {
      failed: true,
      service: "chronoscope",
      reason: "BNL_API_BASE_URL is not configured",
    });
  }

  try {
    const snapshot = await fetchBnlSnapshot(baseUrl);
    const status = snapshot.status ?? "unknown";
    const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
    const failed = status === "error";
    const warning = status === "warning" || warnings.length > 0;

    addEvent(trace.traceId, {
      service: "bnl-league",
      type: "integration.snapshot.received",
      level: failed ? "error" : warning ? "warn" : "info",
      message: `BNL snapshot status: ${status}`,
      data: {
        status,
        counts: snapshot.counts,
        latest: snapshot.latest,
        warnings,
        latencyMs: Date.now() - startedAt,
      },
    });

    return finishTrace(trace.traceId, {
      failed: failed || warning,
      service: "bnl-league",
      statusCode: failed ? 502 : warning ? 409 : 200,
      reason: failed
        ? snapshot.error ?? "BNL snapshot failed"
        : warning
          ? warnings[0] ?? "BNL snapshot reported warnings"
          : "BNL snapshot healthy",
    });
  } catch (error) {
    addEvent(trace.traceId, {
      service: "bnl-league",
      type: "integration.snapshot.failed",
      level: "error",
      message: "Failed to fetch BNL snapshot",
      data: {
        endpoint: `${baseUrl}/chronoscope/snapshot`,
        error: error.message,
        latencyMs: Date.now() - startedAt,
      },
    });

    return finishTrace(trace.traceId, {
      failed: true,
      service: "bnl-league",
      statusCode: 502,
      reason: `BNL snapshot unavailable: ${error.message}`,
    });
  }
}

async function fetchBnlSnapshot(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers = {};

  if (process.env.BNL_CHRONOSCOPE_KEY) {
    headers["x-chronoscope-key"] = process.env.BNL_CHRONOSCOPE_KEY;
  }

  try {
    const response = await fetch(`${baseUrl}/chronoscope/snapshot`, {
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error ?? `BNL API returned HTTP ${response.status}`);
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBaseUrl(value) {
  if (!value) {
    return "";
  }

  const trimmed = value.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

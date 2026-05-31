const TAG_RULES = [
  ["timeout", /\btimeout|timed out|etimedout|deadline\b/i],
  ["validation", /\bvalidation|invalid|schema\b/i],
  ["dependency", /\bdependency|provider|external|upstream|w3champions\b/i],
  ["database", /\bdatabase|db\.|sql|sqlite|mongo|query\b/i],
  ["api", /\bapi|http|statusCode|5\d\d|4\d\d\b/i],
  ["auth", /\bauth|session|token|callback|oauth|permission\b/i],
  ["integration", /\bintegration|snapshot|sync|webhook|callback\b/i],
  ["business-rule", /\bbusiness|invariant|rule|league|season\b/i],
];

const ROOT_CAUSE_RULES = [
  {
    rootCause: "External dependency timeout",
    confidence: 0.87,
    test: ({ text }) => /\btimeout|timed out|etimedout|deadline\b/i.test(text),
    evidence: "A timeout event was detected before the trace failed.",
    actions: ["Verify upstream availability.", "Add retry with backoff.", "Review timeout budget for the dependency."],
  },
  {
    rootCause: "Business validation failure",
    confidence: 0.82,
    test: ({ text }) => /\bvalidation|invalid|invariant|business\.invariant_failed|business rule\b/i.test(text),
    evidence: "A validation or business-rule event blocked the workflow.",
    actions: ["Check the input contract.", "Expose the failing rule in the caller response.", "Add a regression test for this rule."],
  },
  {
    rootCause: "Application error",
    confidence: 0.78,
    test: ({ text, statusCodes }) => statusCodes.some((code) => code >= 500) || /\b5\d\d\b/.test(text),
    evidence: "A 5xx response or server-side error appeared in the replay.",
    actions: ["Inspect service logs around the incident time.", "Add circuit-breaker protection.", "Review the deployment that introduced the error."],
  },
  {
    rootCause: "Authentication or authorization failure",
    confidence: 0.8,
    test: ({ text, statusCodes }) => statusCodes.some((code) => code === 401 || code === 403) || /\bauth|token|permission|oauth\b/i.test(text),
    evidence: "Authentication or authorization evidence appeared before failure.",
    actions: ["Verify token/callback configuration.", "Check identity provider health.", "Confirm the user/session permissions."],
  },
  {
    rootCause: "Database operation failure",
    confidence: 0.79,
    test: ({ text }) => /\bdatabase|db\.|sql|sqlite|mongo|query\b/i.test(text),
    evidence: "Database activity appears in the causal path.",
    actions: ["Check database latency and connection pool saturation.", "Review slow queries.", "Confirm migration compatibility."],
  },
];

export function analyzeReplay(trace, result) {
  const events = [...trace.events];
  const finishedEvents = events;
  const services = unique(finishedEvents.map((event) => event.service).filter(Boolean));
  const errorEvents = finishedEvents.filter((event) => event.level === "error");
  const warningEvents = finishedEvents.filter((event) => event.level === "warn");
  const firstFailure = errorEvents[0] ?? warningEvents[0] ?? null;
  const lastSuccess = [...finishedEvents]
    .reverse()
    .find((event) => event.level === "info" && event.offsetMs <= (firstFailure?.offsetMs ?? Number.POSITIVE_INFINITY));
  const statusCodes = collectStatusCodes(finishedEvents, result);
  const text = JSON.stringify({ events: finishedEvents, result }).toLowerCase();
  const rule = ROOT_CAUSE_RULES.find((candidate) => candidate.test({ text, statusCodes })) ?? fallbackRule(firstFailure);
  const severity = calculateSeverity({ services, errorEvents, warningEvents, statusCodes, durationMs: duration(trace), result });
  const tags = calculateTags({ text, services, statusCodes });
  const confidence = tuneConfidence(rule.confidence, { firstFailure, errorEvents, statusCodes, services });
  const impact = inferImpact(trace, result, services, firstFailure);
  const story = buildStory(finishedEvents, firstFailure);
  const supportingEvidence = buildEvidence({ rule, firstFailure, lastSuccess, errorEvents, warningEvents, statusCodes });
  const comparison = compareWithBaseline(finishedEvents, trace.metadata?.successBaseline);

  return {
    version: "rule-engine-v0.3",
    provider: "local-rules",
    generatedAt: new Date().toISOString(),
    incident: {
      likelyRootCause: rule.rootCause,
      confidence,
      impact,
      affectedServices: services,
      firstFailureEvent: eventLabel(firstFailure),
      lastSuccessfulEvent: eventLabel(lastSuccess),
      durationMs: duration(trace),
      severity,
      tags,
    },
    rootCause: {
      conclusion: rule.rootCause,
      confidence,
      causalChain: buildCausalChain(finishedEvents, firstFailure),
      evidence: supportingEvidence,
    },
    story,
    investigation: {
      hypothesis: rule.rootCause,
      confidence,
      supportingEvidence,
      suggestedActions: rule.actions,
    },
    comparison,
    timeline: {
      firstFailureEventId: firstFailure?.id ?? null,
      causalEventIds: buildCausalChain(finishedEvents, firstFailure).map((event) => event.id),
      noisyEventIds: finishedEvents
        .filter((event) => event.level === "info" && !importantType(event.type))
        .map((event) => event.id),
      groupedByService: Object.fromEntries(
        services.map((service) => [service, finishedEvents.filter((event) => event.service === service).map((event) => event.id)]),
      ),
    },
  };
}

export function summaryFromAnalysis(trace, result, analysis) {
  return {
    headline: result.reason ?? analysis.incident.likelyRootCause,
    services: analysis.incident.affectedServices,
    likelyCause: analysis.incident.likelyRootCause,
    lastObservedStep: analysis.incident.firstFailureEvent,
    severity: analysis.incident.severity,
    tags: analysis.incident.tags,
    confidence: analysis.incident.confidence,
  };
}

function fallbackRule(firstFailure) {
  return {
    rootCause: firstFailure ? `${firstFailure.service} failure` : "Unknown backend failure",
    confidence: firstFailure ? 0.64 : 0.45,
    evidence: firstFailure ? `${firstFailure.type} was the first failing event.` : "The trace finished as failed without detailed error evidence.",
    actions: ["Inspect the first failing service.", "Add more structured failure events.", "Compare against a known successful replay."],
  };
}

function calculateSeverity({ services, errorEvents, statusCodes, durationMs, result }) {
  const has5xx = statusCodes.some((code) => code >= 500);
  const hasAuthOrPaymentImpact = /payment|checkout|auth|league|snapshot|sync/i.test(JSON.stringify({ result, services }));
  const score =
    (has5xx ? 3 : 0) +
    (errorEvents.length >= 3 ? 2 : errorEvents.length) +
    (services.length >= 4 ? 2 : services.length >= 2 ? 1 : 0) +
    (durationMs >= 5000 ? 2 : durationMs >= 1000 ? 1 : 0) +
    (hasAuthOrPaymentImpact ? 1 : 0);

  if (score >= 7) return "Critical";
  if (score >= 5) return "High";
  if (score >= 3) return "Medium";
  return "Low";
}

function calculateTags({ text, services, statusCodes }) {
  const tags = new Set();
  for (const [tag, pattern] of TAG_RULES) {
    if (pattern.test(text)) tags.add(tag);
  }
  if (services.some((service) => /api|gateway/i.test(service)) || statusCodes.length) tags.add("api");
  return [...tags];
}

function tuneConfidence(base, { firstFailure, errorEvents, statusCodes, services }) {
  const bonus =
    (firstFailure ? 0.03 : 0) +
    (errorEvents.length > 1 ? 0.03 : 0) +
    (statusCodes.length ? 0.02 : 0) +
    (services.length > 1 ? 0.01 : 0);
  return Math.min(0.97, Number((base + bonus).toFixed(2)));
}

function inferImpact(trace, result, services, firstFailure) {
  const text = `${trace.name} ${result.reason ?? ""} ${services.join(" ")} ${firstFailure?.message ?? ""}`.toLowerCase();
  if (text.includes("checkout") || text.includes("payment")) return "Checkout requests failed";
  if (text.includes("discord")) return "Discord command could not complete";
  if (text.includes("snapshot")) return "BNL snapshot sync failed or degraded";
  if (text.includes("league")) return "League data update was interrupted";
  if (text.includes("auth")) return "User authentication flow failed";
  return `${services[0] ?? trace.service} workflow failed`;
}

function buildStory(events, firstFailure) {
  return events
    .filter((event) => event.type !== "trace.started")
    .map((event) => ({
      eventId: event.id,
      service: event.service,
      level: event.level,
      text: storyLine(event, firstFailure?.id === event.id),
    }));
}

function storyLine(event, isFirstFailure) {
  const prefix = isFirstFailure ? "Failure point: " : "";
  if (/request|command/i.test(event.type)) return `${prefix}${event.message || "Request was received"}.`;
  if (/reserved|success|validated|loaded|received/i.test(`${event.type} ${event.message}`)) return `${prefix}${event.message}.`;
  if (/timeout/i.test(`${event.type} ${event.message}`)) return `${prefix}${event.service} did not respond within the expected time.`;
  if (/rollback/i.test(`${event.type} ${event.message}`)) return `${prefix}${event.message}.`;
  if (event.level === "error") return `${prefix}${event.message || `${event.service} failed`}.`;
  return `${prefix}${event.message || event.type}.`;
}

function buildCausalChain(events, firstFailure) {
  if (!firstFailure) return events.slice(-4);
  const failureIndex = events.findIndex((event) => event.id === firstFailure.id);
  return events.slice(Math.max(0, failureIndex - 3), Math.min(events.length, failureIndex + 3));
}

function buildEvidence({ rule, firstFailure, lastSuccess, errorEvents, warningEvents, statusCodes }) {
  return [
    rule.evidence,
    firstFailure ? `First failure: ${eventLabel(firstFailure)}.` : null,
    lastSuccess ? `Last successful step: ${eventLabel(lastSuccess)}.` : null,
    statusCodes.length ? `Observed status codes: ${unique(statusCodes).join(", ")}.` : null,
    errorEvents.length ? `${errorEvents.length} error event(s) captured.` : null,
    warningEvents.length ? `${warningEvents.length} warning event(s) captured.` : null,
  ].filter(Boolean);
}

function compareWithBaseline(events, baseline = []) {
  if (!Array.isArray(baseline) || baseline.length === 0) {
    return {
      baselineName: "No successful baseline attached",
      differences: [],
      missingEvents: [],
      timingDifferences: [],
      payloadDifferences: [],
    };
  }

  const failedTypes = events.map((event) => event.type);
  const successTypes = baseline.map((event) => event.type);
  const missingEvents = successTypes
    .filter((type) => !failedTypes.includes(type))
    .map((type) => ({ type, success: "present", failed: "missing" }));
  const differentEvents = events
    .filter((event) => {
      const match = baseline.find((item) => item.type === event.type);
      return match && JSON.stringify(match.data ?? {}) !== JSON.stringify(event.data ?? {});
    })
    .map((event) => ({
      type: event.type,
      failed: compactData(event.data),
      success: compactData(baseline.find((item) => item.type === event.type)?.data),
    }));
  const timingDifferences = events
    .map((event) => {
      const match = baseline.find((item) => item.type === event.type);
      if (!match) return null;
      const deltaMs = event.offsetMs - match.offsetMs;
      return Math.abs(deltaMs) > 50 ? { type: event.type, deltaMs } : null;
    })
    .filter(Boolean);

  return {
    baselineName: "BNL successful execution",
    differences: [
      ...missingEvents.map((item) => `${item.type} is missing from the failed replay.`),
      ...differentEvents.map((item) => `${item.type} payload changed.`),
      ...timingDifferences.map((item) => `${item.type} was ${Math.abs(item.deltaMs)}ms ${item.deltaMs > 0 ? "slower" : "faster"}.`),
    ],
    missingEvents,
    timingDifferences,
    payloadDifferences: differentEvents,
  };
}

function collectStatusCodes(events, result) {
  const codes = [];
  if (Number.isFinite(result.statusCode)) codes.push(result.statusCode);
  for (const event of events) {
    collectCodes(event.data, codes);
  }
  return codes;
}

function collectCodes(value, codes) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/status/i.test(key) && Number.isFinite(item)) codes.push(item);
    collectCodes(item, codes);
  }
}

function compactData(data) {
  if (!data || typeof data !== "object") return data ?? null;
  return Object.fromEntries(Object.entries(data).slice(0, 4));
}

function duration(trace) {
  return Date.now() - Date.parse(trace.startedAt);
}

function eventLabel(event) {
  return event ? `${event.type} (${event.service})` : "Unknown";
}

function importantType(type) {
  return /request|response|timeout|failed|success|reserved|callback|sync|update|command/i.test(type);
}

function unique(items) {
  return [...new Set(items)];
}

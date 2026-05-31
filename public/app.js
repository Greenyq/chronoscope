let selectedReplayId = null;
let selectedReplay = null;
let selectedEventId = null;
let allReplays = [];
let sortNewestFirst = true;

const els = {
  apiKey: document.querySelector("#apiKey"),
  apiState: document.querySelector("#apiState"),
  topApiState: document.querySelector("#topApiState"),
  statusLine: document.querySelector("#statusLine"),
  replayCount: document.querySelector("#replayCount"),
  replayList: document.querySelector("#replayList"),
  searchInput: document.querySelector("#searchInput"),
  globalSearch: document.querySelector("#globalSearch"),
  serviceFilter: document.querySelector("#serviceFilter"),
  levelFilter: document.querySelector("#levelFilter"),
  sortToggle: document.querySelector("#sortToggle"),
  emptyState: document.querySelector("#emptyState"),
  detailView: document.querySelector("#detailView"),
  title: document.querySelector("#title"),
  subtitle: document.querySelector("#subtitle"),
  statusBadge: document.querySelector("#statusBadge"),
  statusIcon: document.querySelector("#statusIcon"),
  durationLarge: document.querySelector("#durationLarge"),
  severityBadge: document.querySelector("#severityBadge"),
  confidenceScore: document.querySelector("#confidenceScore"),
  impactText: document.querySelector("#impactText"),
  firstFailureEvent: document.querySelector("#firstFailureEvent"),
  lastSuccessfulEvent: document.querySelector("#lastSuccessfulEvent"),
  tagPills: document.querySelector("#tagPills"),
  likelyCauseTitle: document.querySelector("#likelyCauseTitle"),
  likelyCause: document.querySelector("#likelyCause"),
  serviceCount: document.querySelector("#serviceCount"),
  servicePills: document.querySelector("#servicePills"),
  rootCauseConfidence: document.querySelector("#rootCauseConfidence"),
  causalChain: document.querySelector("#causalChain"),
  investigationBody: document.querySelector("#investigationBody"),
  incidentStory: document.querySelector("#incidentStory"),
  comparisonBody: document.querySelector("#comparisonBody"),
  timelineCount: document.querySelector("#timelineCount"),
  timelineRows: document.querySelector("#timelineRows"),
  selectedEventId: document.querySelector("#selectedEventId"),
  eventDetailBody: document.querySelector("#eventDetailBody"),
  payloadLabel: document.querySelector("#payloadLabel"),
  payloadCode: document.querySelector("#payloadCode"),
  metadataCode: document.querySelector("#metadataCode"),
  traceSummary: document.querySelector("#traceSummary"),
};

els.apiKey.value = localStorage.getItem("chronoscopeApiKey") ?? "";
updateApiState();

document.querySelector("#saveApiKey").addEventListener("click", () => {
  localStorage.setItem("chronoscopeApiKey", els.apiKey.value.trim());
  updateApiState();
  setStatus("API key saved", "ok");
  loadReplays();
});

document.querySelector("#runDemo").addEventListener("click", () =>
  runAction("Demo incident captured", async () => {
    await apiFetch("/api/demo", { method: "POST" });
    await loadReplays();
  }),
);

document.querySelector("#runBnl").addEventListener("click", () =>
  runAction("BNL probe completed", async () => {
    await apiFetch("/api/bnl/probe", { method: "POST" });
    await loadReplays();
  }),
);

document.querySelector("#exportJson").addEventListener("click", exportSelectedReplay);
document.querySelector("#copyPayload").addEventListener("click", () => copyText(els.payloadCode.textContent));
document.querySelector("#backToReplays").addEventListener("click", () => {
  selectedReplayId = null;
  selectedReplay = null;
  selectedEventId = null;
  renderDetail();
  renderReplayList();
});

els.searchInput.addEventListener("input", renderReplayList);
els.globalSearch.addEventListener("input", renderDetail);
els.serviceFilter.addEventListener("change", renderReplayList);
els.levelFilter.addEventListener("change", renderReplayList);
els.sortToggle.addEventListener("click", () => {
  sortNewestFirst = !sortNewestFirst;
  els.sortToggle.textContent = sortNewestFirst ? "Newest First" : "Oldest First";
  renderReplayList();
});

await loadReplays();

async function loadReplays() {
  try {
    const response = await apiFetch("/api/replays");
    const { replays } = await response.json();

    allReplays = replays;
    syncServiceFilter(replays);
    renderReplayList();

    if (!selectedReplayId && replays[0]) {
      await loadReplay(replays[0].replayId);
    } else if (selectedReplayId) {
      const stillExists = replays.some((replay) => replay.replayId === selectedReplayId);
      if (stillExists) await loadReplay(selectedReplayId);
    }

    setStatus("Ready", "neutral");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function loadReplay(replayId) {
  const response = await apiFetch(`/api/replays/${replayId}`);
  const { replay } = await response.json();

  selectedReplayId = replayId;
  selectedReplay = replay;
  selectedEventId = selectedEventId && replay.events.some((event) => event.id === selectedEventId)
    ? selectedEventId
    : replay.events.find((event) => event.level === "error")?.id ?? replay.events[0]?.id ?? null;

  renderReplayList();
  renderDetail();
}

function renderReplayList() {
  const visible = filterReplays(allReplays);
  els.replayCount.textContent = visible.length;
  els.replayList.innerHTML = "";

  if (!visible.length) {
    els.replayList.innerHTML = `<div class="list-empty">No replays match the current filters.</div>`;
    return;
  }

  const grouped = groupByDay(visible);
  for (const [label, replays] of grouped) {
    const group = document.createElement("section");
    group.className = "replay-group";
    group.innerHTML = `<h3>${escapeHtml(label)}</h3>`;

    for (const replay of replays) {
      const summary = replay.summary ?? {};
      const level = getReplayLevel(replay);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `replay-card ${selectedReplayId === replay.replayId ? "active" : ""} ${level}`;
      button.innerHTML = `
        <span class="severity-dot"></span>
        <span class="replay-main">
          <strong>${escapeHtml(replay.name)}</strong>
          <span>${escapeHtml(replay.service)} · ${formatDateTime(replay.finishedAt)}</span>
          <small>${escapeHtml(summary.headline ?? replay.reason)}</small>
        </span>
        <span class="replay-side">
          <span class="badge ${level}">${level}</span>
          <span>${formatDuration(replay.durationMs)}</span>
        </span>
      `;
      button.addEventListener("click", () => loadReplay(replay.replayId));
      group.append(button);
    }

    els.replayList.append(group);
  }
}

function renderDetail() {
  if (!selectedReplay) {
    els.emptyState.classList.remove("hidden");
    els.detailView.classList.add("hidden");
    return;
  }

  els.emptyState.classList.add("hidden");
  els.detailView.classList.remove("hidden");

  const replay = selectedReplay;
  const summary = replay.summary ?? {};
  const analysis = ensureAnalysis(replay);
  const incident = analysis.incident;
  const services = normalizeServices(incident.affectedServices ?? summary.services, replay.events);
  const selectedEvent = replay.events.find((event) => event.id === selectedEventId) ?? replay.events[0];
  const filteredEvents = filterEvents(replay.events, els.globalSearch.value);

  els.title.textContent = replay.name;
  els.subtitle.innerHTML = `
    <span>ID: ${escapeHtml(replay.replayId)}</span>
    <span>${escapeHtml(formatIncidentTime(replay))}</span>
    <span>${escapeHtml(formatDuration(replay.durationMs))}</span>
    <span>${escapeHtml(incident.impact)}</span>
    <span class="env-pill">production</span>
  `;
  els.statusBadge.textContent = "Failed";
  els.statusBadge.className = "badge error";
  els.statusIcon.textContent = "!";
  els.durationLarge.textContent = formatDuration(replay.durationMs);
  els.severityBadge.textContent = incident.severity;
  els.severityBadge.className = `severity-badge ${incident.severity.toLowerCase()}`;
  els.confidenceScore.textContent = formatConfidence(incident.confidence);
  els.impactText.textContent = incident.impact;
  els.firstFailureEvent.textContent = incident.firstFailureEvent;
  els.lastSuccessfulEvent.textContent = incident.lastSuccessfulEvent;
  els.likelyCauseTitle.textContent = incident.likelyRootCause;
  els.likelyCause.textContent = analysis.rootCause?.evidence?.[0] ?? summary.likelyCause ?? replay.reason;
  els.serviceCount.textContent = services.length;
  els.servicePills.innerHTML = services.map((service) => `<span>${escapeHtml(service)}</span>`).join("");
  els.tagPills.innerHTML = (incident.tags ?? []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  els.rootCauseConfidence.textContent = `${formatConfidence(analysis.rootCause?.confidence ?? incident.confidence)} confidence`;
  els.timelineCount.textContent = `${filteredEvents.length} events`;
  els.metadataCode.textContent = JSON.stringify(
    {
      traceId: replay.traceId,
      replayId: replay.replayId,
      status: replay.status,
      reason: replay.reason,
      startedAt: replay.startedAt,
      finishedAt: replay.finishedAt,
      durationMs: replay.durationMs,
      metadata: replay.metadata,
      analysisProvider: analysis.provider,
      generatedAt: analysis.generatedAt,
    },
    null,
    2,
  );
  els.traceSummary.innerHTML = summaryRows({
    "Trace ID": replay.traceId,
    Name: replay.name,
    Environment: "production",
    Severity: incident.severity,
    Confidence: formatConfidence(incident.confidence),
    "Started At": formatDateTime(replay.startedAt),
    "Finished At": formatDateTime(replay.finishedAt),
    Status: "Failed",
  });

  renderCausalChain(analysis);
  renderInvestigation(analysis);
  renderStory(analysis);
  renderComparison(analysis);
  renderTimeline(filteredEvents, analysis);
  renderEventDetails(selectedEvent);
}

function renderTimeline(events, analysis) {
  els.timelineRows.innerHTML = "";
  const firstFailureId = analysis.timeline?.firstFailureEventId;
  const causalIds = new Set(analysis.timeline?.causalEventIds ?? []);
  const noisyIds = new Set(analysis.timeline?.noisyEventIds ?? []);

  if (!events.length) {
    els.timelineRows.innerHTML = `<div class="list-empty">No events match the current search.</div>`;
    return;
  }

  for (const event of events) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = [
      "event-row",
      event.level,
      event.id === selectedEventId ? "selected" : "",
      event.id === firstFailureId ? "first-failure" : "",
      causalIds.has(event.id) ? "causal" : "",
      noisyIds.has(event.id) ? "noisy" : "",
    ].filter(Boolean).join(" ");
    row.innerHTML = `
      <span class="event-time">+${formatDuration(event.offsetMs)}</span>
      <span class="event-line"><span></span></span>
      <span class="event-copy">
        <strong>${escapeHtml(event.message || event.type)}</strong>
        <small>${escapeHtml(event.service)} · ${escapeHtml(event.type)}</small>
      </span>
      <span class="event-status">${escapeHtml(event.level)}</span>
      <span class="event-note">${escapeHtml(event.level === "error" ? event.message : summarizeEventData(event.data))}</span>
    `;
    row.addEventListener("click", () => {
      selectedEventId = event.id;
      renderDetail();
    });
    els.timelineRows.append(row);
  }
}

function renderCausalChain(analysis) {
  const chain = analysis.rootCause?.causalChain ?? [];
  els.causalChain.innerHTML = chain
    .map((event) => `
      <li>
        <strong>${escapeHtml(event.type)}</strong>
        <span>${escapeHtml(event.service)} · ${escapeHtml(event.message || event.level)}</span>
      </li>
    `)
    .join("");
}

function renderInvestigation(analysis) {
  const investigation = analysis.investigation ?? {};
  els.investigationBody.innerHTML = `
    <div class="hypothesis">
      <span class="label">Hypothesis</span>
      <strong>${escapeHtml(investigation.hypothesis ?? "Unknown incident")}</strong>
      <span>${escapeHtml(formatConfidence(investigation.confidence ?? 0))}</span>
    </div>
    <h4>Supporting Evidence</h4>
    <ul>${(investigation.supportingEvidence ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <h4>Suggested Actions</h4>
    <ul>${(investigation.suggestedActions ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  `;
}

function renderStory(analysis) {
  els.incidentStory.innerHTML = (analysis.story ?? [])
    .map((item) => `<li class="${escapeHtml(item.level)}"><span>${escapeHtml(item.service)}</span>${escapeHtml(item.text)}</li>`)
    .join("");
}

function renderComparison(analysis) {
  const comparison = analysis.comparison ?? {};
  const differences = comparison.differences ?? [];

  if (!differences.length) {
    els.comparisonBody.innerHTML = `<div class="list-empty">${escapeHtml(comparison.baselineName ?? "No successful baseline attached")}</div>`;
    return;
  }

  els.comparisonBody.innerHTML = `
    <div class="comparison-columns">
      <div><span>FAILED replay</span><strong>${escapeHtml(selectedReplay.reason)}</strong></div>
      <div><span>SUCCESSFUL replay</span><strong>${escapeHtml(comparison.baselineName ?? "Baseline")}</strong></div>
    </div>
    <ul class="diff-list">
      ${differences.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderEventDetails(event) {
  if (!event) {
    els.selectedEventId.textContent = "No event selected";
    els.eventDetailBody.innerHTML = `<p class="muted">Select an event from the timeline.</p>`;
    els.payloadCode.textContent = "{}";
    return;
  }

  els.selectedEventId.textContent = `Event ID: ${event.id.slice(0, 10)}`;
  els.eventDetailBody.innerHTML = `
    <div class="event-detail-title">
      <span class="detail-icon ${escapeHtml(event.level)}">${escapeHtml(event.level[0] ?? "i")}</span>
      <div>
        <strong>${escapeHtml(event.message || event.type)}</strong>
        <span>${escapeHtml(event.service)}</span>
      </div>
      <span class="badge ${escapeHtml(event.level)}">${escapeHtml(event.level)}</span>
    </div>
    <dl>
      ${summaryRows({
        Time: `${formatDuration(event.offsetMs)} from start`,
        Service: event.service,
        Type: event.type,
        Level: event.level,
        Message: event.message || "-",
      })}
    </dl>
  `;
  els.payloadLabel.textContent = `${event.service} payload`;
  els.payloadCode.textContent = JSON.stringify(event.data ?? {}, null, 2);
}

function filterReplays(replays) {
  const query = els.searchInput.value.trim().toLowerCase();
  const service = els.serviceFilter.value;
  const level = els.levelFilter.value;

  return [...replays]
    .filter((replay) => {
      const text = `${replay.name} ${replay.reason} ${replay.service} ${replay.replayId}`.toLowerCase();
      const matchesQuery = !query || text.includes(query);
      const matchesService = !service || replay.service === service;
      const matchesLevel = !level || getReplayLevel(replay) === level;
      return matchesQuery && matchesService && matchesLevel;
    })
    .sort((a, b) =>
      sortNewestFirst
        ? Date.parse(b.finishedAt) - Date.parse(a.finishedAt)
        : Date.parse(a.finishedAt) - Date.parse(b.finishedAt),
    );
}

function filterEvents(events, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return events;

  return events.filter((event) =>
    `${event.service} ${event.type} ${event.level} ${event.message} ${JSON.stringify(event.data)}`.
      toLowerCase()
      .includes(normalized),
  );
}

function syncServiceFilter(replays) {
  const current = els.serviceFilter.value;
  const services = [...new Set(replays.map((replay) => replay.service).filter(Boolean))].sort();
  els.serviceFilter.innerHTML = `<option value="">All Services</option>${services
    .map((service) => `<option value="${escapeHtml(service)}">${escapeHtml(service)}</option>`)
    .join("")}`;
  els.serviceFilter.value = services.includes(current) ? current : "";
}

async function runAction(successMessage, action) {
  setStatus("Working...", "busy");
  try {
    await action();
    setStatus(successMessage, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetchWithApiKey(url, options);

  if (response.status === 401) {
    throw new Error("API key required");
  }

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }

  return response;
}

function fetchWithApiKey(url, options) {
  const headers = new Headers(options.headers ?? {});
  const apiKey = els.apiKey.value.trim() || localStorage.getItem("chronoscopeApiKey");

  if (apiKey) {
    localStorage.setItem("chronoscopeApiKey", apiKey);
    headers.set("X-API-Key", apiKey);
  }

  updateApiState();
  return fetch(url, { ...options, headers });
}

function setStatus(message, state) {
  els.statusLine.textContent = message;
  els.statusLine.className = `status-line ${state}`;
}

function updateApiState() {
  const hasKey = Boolean(els.apiKey.value.trim() || localStorage.getItem("chronoscopeApiKey"));
  els.apiState.classList.toggle("on", hasKey);
  els.topApiState.classList.toggle("on", hasKey);
}

function exportSelectedReplay() {
  if (!selectedReplay) return;

  const blob = new Blob([JSON.stringify(selectedReplay, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${selectedReplay.replayId}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus("Copied", "ok");
  } catch {
    setStatus("Copy unavailable", "error");
  }
}

function groupByDay(replays) {
  const groups = new Map();

  for (const replay of replays) {
    const label = dayLabel(replay.finishedAt);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(replay);
  }

  return groups;
}

function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function getReplayLevel(replay) {
  const severity = replay.analysis?.incident?.severity?.toLowerCase();
  if (severity === "low") return "info";
  if (severity === "medium") return "warn";
  const headline = `${replay.reason} ${replay.summary?.headline ?? ""}`.toLowerCase();
  if (headline.includes("warn")) return "warn";
  return "error";
}

function ensureAnalysis(replay) {
  if (replay.analysis?.incident) return replay.analysis;

  const services = normalizeServices(replay.summary?.services, replay.events);
  const errorEvent = replay.events.find((event) => event.level === "error");
  const lastSuccess = [...replay.events].reverse().find((event) => event.level === "info");
  const tags = inferTags(replay);

  return {
    provider: "legacy-summary",
    generatedAt: replay.finishedAt,
    incident: {
      likelyRootCause: replay.summary?.likelyCause ?? replay.reason,
      confidence: 0.58,
      impact: `${services[0] ?? replay.service} workflow failed`,
      affectedServices: services,
      firstFailureEvent: errorEvent ? `${errorEvent.type} (${errorEvent.service})` : "Unknown",
      lastSuccessfulEvent: lastSuccess ? `${lastSuccess.type} (${lastSuccess.service})` : "Unknown",
      durationMs: replay.durationMs,
      severity: "Medium",
      tags,
    },
    rootCause: {
      confidence: 0.58,
      evidence: [replay.summary?.likelyCause ?? replay.reason],
      causalChain: replay.events.slice(-5),
    },
    story: replay.events.map((event) => ({
      service: event.service,
      level: event.level,
      text: `${event.message || event.type}.`,
    })),
    investigation: {
      hypothesis: replay.summary?.likelyCause ?? replay.reason,
      confidence: 0.58,
      supportingEvidence: [replay.summary?.lastObservedStep ?? replay.reason],
      suggestedActions: ["Inspect the first failing event.", "Compare with a successful replay.", "Add a more specific analysis rule."],
    },
    comparison: { baselineName: "No successful baseline attached", differences: [] },
    timeline: {
      firstFailureEventId: errorEvent?.id ?? null,
      causalEventIds: replay.events.slice(-5).map((event) => event.id),
      noisyEventIds: [],
    },
  };
}

function inferTags(replay) {
  const text = JSON.stringify(replay).toLowerCase();
  return [
    ["timeout", "timeout"],
    ["validation", "validation"],
    ["dependency", "dependency"],
    ["database", "database"],
    ["api", "api"],
    ["auth", "auth"],
    ["integration", "integration"],
    ["business-rule", "business"],
  ].filter(([, needle]) => text.includes(needle)).map(([tag]) => tag);
}

function countLevels(events) {
  return events.reduce(
    (counts, event) => {
      counts[event.level] = (counts[event.level] ?? 0) + 1;
      return counts;
    },
    { info: 0, warn: 0, error: 0 },
  );
}

function normalizeServices(summaryServices, events) {
  if (Array.isArray(summaryServices)) return summaryServices;
  return [...new Set(events.map((event) => event.service).filter(Boolean))];
}

function summarizeEventData(data) {
  if (!data || typeof data !== "object") return "";
  const entries = Object.entries(data).slice(0, 2);
  return entries.map(([key, value]) => `${key}: ${String(value).slice(0, 28)}`).join(" · ");
}

function summaryRows(values) {
  return Object.entries(values)
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value ?? "-")}</dd>`)
    .join("");
}

function formatIncidentTime(replay) {
  const started = formatDateTime(replay.startedAt);
  const finished = formatDateTime(replay.finishedAt);

  if (started === finished) {
    return `${finished} (${formatRelativeTime(replay.finishedAt)})`;
  }

  return `${started} -> ${finished} (${formatRelativeTime(replay.finishedAt)})`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";

  const divisions = [
    { amount: 60, unit: "second" },
    { amount: 60, unit: "minute" },
    { amount: 24, unit: "hour" },
    { amount: 7, unit: "day" },
    { amount: 4.345, unit: "week" },
    { amount: 12, unit: "month" },
    { amount: Number.POSITIVE_INFINITY, unit: "year" },
  ];
  let duration = Math.round((date.getTime() - Date.now()) / 1000);

  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
        Math.round(duration),
        division.unit,
      );
    }
    duration /= division.amount;
  }

  return "unknown";
}

function formatDuration(ms) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 2 : 1)}s`;
}

function formatConfidence(value) {
  const normalized = Number(value) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(normalized || 0)}%`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

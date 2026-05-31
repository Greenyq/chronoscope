let selectedReplayId = null;

const replayList = document.querySelector("#replayList");
const replayCount = document.querySelector("#replayCount");
const sourceCount = document.querySelector("#sourceCount");
const statusLine = document.querySelector("#statusLine");
const apiKeyInput = document.querySelector("#apiKey");
const title = document.querySelector("#title");
const subtitle = document.querySelector("#subtitle");
const incidentTime = document.querySelector("#incidentTime");
const likelyCause = document.querySelector("#likelyCause");
const services = document.querySelector("#services");
const duration = document.querySelector("#duration");
const eventCount = document.querySelector("#eventCount");
const timeline = document.querySelector("#timeline");

apiKeyInput.value = localStorage.getItem("chronoscopeApiKey") ?? "";

document.querySelector("#saveApiKey").addEventListener("click", () => {
  localStorage.setItem("chronoscopeApiKey", apiKeyInput.value.trim());
  statusLine.textContent = "API key saved";
  statusLine.className = "status-line ok";
});

document.querySelector("#runDemo").addEventListener("click", async () => {
  await runAction("Demo incident captured", async () => {
    await apiFetch("/api/demo", { method: "POST" });
    await loadReplays();
  });
});

document.querySelector("#runBnl").addEventListener("click", async () => {
  await runAction("BNL probe captured", async () => {
    await apiFetch("/api/bnl/probe", { method: "POST" });
    await loadReplays();
  });
});

document.querySelector("#refresh").addEventListener("click", loadReplays);

await loadReplays();

async function loadReplays() {
  const response = await apiFetch("/api/replays");
  const { replays } = await response.json();

  replayCount.textContent = replays.length;
  sourceCount.textContent = selectedReplayId?.startsWith("run_") ? "Live" : "API";
  replayList.innerHTML = "";

  for (const replay of replays) {
    const button = document.createElement("button");
    button.className = `replay-item ${replay.replayId === selectedReplayId ? "active" : ""}`;
    button.innerHTML = `
      <span class="replay-kicker">${escapeHtml(replay.service)} - ${formatRelativeTime(replay.finishedAt)}</span>
      <strong>${escapeHtml(replay.name)}</strong>
      <span>${escapeHtml(replay.reason)}</span>
      <span class="replay-time">${formatDateTime(replay.finishedAt)} - ${replay.eventCount} events</span>
    `;
    button.addEventListener("click", () => loadReplay(replay.replayId));
    replayList.append(button);
  }

  if (!selectedReplayId && replays[0]) {
    await loadReplay(replays[0].replayId);
  }
}

async function loadReplay(replayId) {
  selectedReplayId = replayId;
  const response = await apiFetch(`/api/replays/${replayId}`);
  const { replay } = await response.json();

  title.textContent = replay.name;
  subtitle.textContent = `${replay.replayId} - ${replay.reason}`;
  incidentTime.textContent = formatIncidentTime(replay);
  likelyCause.textContent = replay.summary.likelyCause;
  services.textContent = replay.summary.services.join(", ");
  duration.textContent = `${replay.durationMs}ms`;
  eventCount.textContent = `${replay.events.length} events`;
  timeline.className = "timeline";
  timeline.innerHTML = "";

  for (const event of replay.events) {
    const item = document.createElement("article");
    item.className = `event ${event.level === "error" ? "error" : event.level === "warn" ? "warn" : ""}`;
    item.innerHTML = `
      <div class="time">+${event.offsetMs}ms</div>
      <div>
        <div class="service">${escapeHtml(event.service)}</div>
        <span class="level ${escapeHtml(event.level)}">${escapeHtml(event.level)}</span>
      </div>
      <div>
        <span class="type">${escapeHtml(event.type)}</span>
        <p class="message">${escapeHtml(event.message)}</p>
        <pre class="payload">${escapeHtml(JSON.stringify(event.data, null, 2))}</pre>
      </div>
    `;
    timeline.append(item);
  }

  await loadReplaysWithoutAutoSelect();
}

async function loadReplaysWithoutAutoSelect() {
  const response = await apiFetch("/api/replays");
  const { replays } = await response.json();

  replayCount.textContent = replays.length;
  replayList.innerHTML = "";

  for (const replay of replays) {
    const button = document.createElement("button");
    button.className = `replay-item ${replay.replayId === selectedReplayId ? "active" : ""}`;
    button.innerHTML = `
      <span class="replay-kicker">${escapeHtml(replay.service)} - ${formatRelativeTime(replay.finishedAt)}</span>
      <strong>${escapeHtml(replay.name)}</strong>
      <span>${escapeHtml(replay.reason)}</span>
      <span class="replay-time">${formatDateTime(replay.finishedAt)} - ${replay.eventCount} events</span>
    `;
    button.addEventListener("click", () => loadReplay(replay.replayId));
    replayList.append(button);
  }
}

async function runAction(successMessage, action) {
  statusLine.textContent = "Working...";
  statusLine.className = "status-line busy";

  try {
    await action();
    statusLine.textContent = successMessage;
    statusLine.className = "status-line ok";
  } catch (error) {
    statusLine.textContent = error.message;
    statusLine.className = "status-line error";
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetchWithApiKey(url, options);

  if (response.status === 401) {
    statusLine.textContent = "API key required";
    statusLine.className = "status-line error";
    throw new Error("API key required");
  }

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }

  return response;
}

function fetchWithApiKey(url, options) {
  const headers = new Headers(options.headers ?? {});
  const apiKey = apiKeyInput.value.trim() || localStorage.getItem("chronoscopeApiKey");

  if (apiKey) {
    localStorage.setItem("chronoscopeApiKey", apiKey);
    headers.set("X-API-Key", apiKey);
  }

  return fetch(url, { ...options, headers });
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
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

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

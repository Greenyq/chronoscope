let selectedReplayId = null;

const replayList = document.querySelector("#replayList");
const replayCount = document.querySelector("#replayCount");
const title = document.querySelector("#title");
const subtitle = document.querySelector("#subtitle");
const likelyCause = document.querySelector("#likelyCause");
const services = document.querySelector("#services");
const duration = document.querySelector("#duration");
const timeline = document.querySelector("#timeline");

document.querySelector("#runDemo").addEventListener("click", async () => {
  await fetch("/api/demo", { method: "POST" });
  await loadReplays();
});

document.querySelector("#refresh").addEventListener("click", loadReplays);

await loadReplays();

async function loadReplays() {
  const response = await fetch("/api/replays");
  const { replays } = await response.json();

  replayCount.textContent = replays.length;
  replayList.innerHTML = "";

  for (const replay of replays) {
    const button = document.createElement("button");
    button.className = `replay-item ${replay.replayId === selectedReplayId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(replay.name)}</strong>
      <span>${escapeHtml(replay.reason)} - ${replay.eventCount} events</span>
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
  const response = await fetch(`/api/replays/${replayId}`);
  const { replay } = await response.json();

  title.textContent = replay.name;
  subtitle.textContent = `${replay.replayId} - ${replay.reason}`;
  likelyCause.textContent = replay.summary.likelyCause;
  services.textContent = replay.summary.services.join(", ");
  duration.textContent = `${replay.durationMs}ms`;
  timeline.className = "timeline";
  timeline.innerHTML = "";

  for (const event of replay.events) {
    const item = document.createElement("article");
    item.className = `event ${event.level === "error" ? "error" : ""}`;
    item.innerHTML = `
      <div class="time">+${event.offsetMs}ms</div>
      <div class="service">${escapeHtml(event.service)}</div>
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
  const response = await fetch("/api/replays");
  const { replays } = await response.json();

  replayCount.textContent = replays.length;
  replayList.innerHTML = "";

  for (const replay of replays) {
    const button = document.createElement("button");
    button.className = `replay-item ${replay.replayId === selectedReplayId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(replay.name)}</strong>
      <span>${escapeHtml(replay.reason)} - ${replay.eventCount} events</span>
    `;
    button.addEventListener("click", () => loadReplay(replay.replayId));
    replayList.append(button);
  }
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

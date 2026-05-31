import { addEvent, createTrace, finishTrace } from "./store.js";

const BNL_SUCCESS_BASELINE = [
  {
    offsetMs: 0,
    service: "bnl-discord-bot",
    type: "discord.command.received",
    level: "info",
    message: "Discord command !match received",
    data: { command: "!match", guildId: "456789123", userHash: "usr_greenyq" },
  },
  {
    offsetMs: 45,
    service: "bnl-api",
    type: "auth.callback.validated",
    level: "info",
    message: "Authenticated Discord callback",
    data: { statusCode: 200, provider: "discord" },
  },
  {
    offsetMs: 120,
    service: "w3champions-api",
    type: "external.match.lookup",
    level: "info",
    message: "Loaded W3Champions match data",
    data: { statusCode: 200, matches: 15, paymentStatus: "approved" },
  },
  {
    offsetMs: 220,
    service: "bnl-sync-service",
    type: "snapshot.sync.completed",
    level: "info",
    message: "BNL snapshot sync completed",
    data: { players: 85, teams: 11, clanWars: 55, activeClanWars: 51 },
  },
  {
    offsetMs: 310,
    service: "bnl-api",
    type: "league.update.completed",
    level: "info",
    message: "League standings updated",
    data: { season: 21, rowsUpdated: 12, status: "published" },
  },
  {
    offsetMs: 360,
    service: "bnl-discord-bot",
    type: "discord.response.sent",
    level: "info",
    message: "Discord response sent",
    data: { status: "delivered" },
  },
];

const FAILURE_SCENARIOS = [
  {
    name: "W3Champions API timeout",
    reason: "W3Champions API timeout blocked BNL match lookup",
    failureService: "w3champions-api",
    statusCode: 504,
    events: [
      event("bnl-discord-bot", "discord.command.received", "Discord command !match received", {
        command: "!match",
        guildId: "456789123",
        userHash: "usr_greenyq",
      }),
      event("bnl-api", "auth.callback.validated", "Authenticated Discord callback", {
        statusCode: 200,
        provider: "discord",
      }),
      event("w3champions-api", "external.match.lookup", "Requesting W3Champions match data", {
        method: "GET",
        url: "https://api.w3champions.com/matches",
      }),
      event("w3champions-api", "external.match.timeout", "W3Champions API did not respond within 5 seconds", {
        timeoutMs: 5000,
        error: "ETIMEDOUT",
        statusCode: 504,
      }, "error"),
      event("bnl-discord-bot", "discord.response.failed", "Discord command failed before response", {
        status: "failed",
        userMessage: "Could not load match data",
      }, "error"),
    ],
  },
  {
    name: "Snapshot sync failure",
    reason: "BNL snapshot sync failed while refreshing league data",
    failureService: "bnl-sync-service",
    statusCode: 500,
    events: [
      event("bnl-scheduler", "snapshot.refresh.started", "Scheduled BNL snapshot refresh started", {
        cadence: "5m",
      }),
      event("bnl-api", "league.state.loaded", "Loaded current league state", {
        statusCode: 200,
        season: 21,
      }),
      event("bnl-sync-service", "snapshot.diff.created", "Created snapshot diff", {
        players: 85,
        teams: 11,
        clanWars: 55,
      }),
      event("bnl-sync-service", "database.write.failed", "Failed to persist snapshot diff", {
        table: "snapshot_versions",
        statusCode: 500,
        error: "SQLITE_BUSY",
      }, "error"),
      event("bnl-api", "snapshot.publish.skipped", "Snapshot publish skipped after persistence failure", {
        status: "skipped",
      }, "warn"),
    ],
  },
  {
    name: "Authentication callback failure",
    reason: "Discord authentication callback was rejected",
    failureService: "bnl-api",
    statusCode: 401,
    events: [
      event("bnl-web", "auth.callback.received", "Received Discord authentication callback", {
        provider: "discord",
      }),
      event("bnl-api", "auth.token.validation", "Validating callback token", {
        issuer: "discord",
      }),
      event("bnl-api", "auth.token.invalid", "Callback token validation failed", {
        statusCode: 401,
        reason: "expired_token",
      }, "error"),
      event("bnl-web", "auth.session.denied", "User session was not created", {
        status: "denied",
      }, "error"),
    ],
  },
];

export async function runScenario({ shouldFail }) {
  if (!shouldFail) {
    return runBnlSuccessScenario();
  }

  return runBnlFailureScenario(FAILURE_SCENARIOS[0]);
}

async function runBnlSuccessScenario() {
  const trace = createBnlTrace("BNL Discord command happy path");

  for (const item of BNL_SUCCESS_BASELINE) {
    await pause(8);
    addEvent(trace.traceId, stripOffset(item));
  }

  return finishTrace(trace.traceId, {
    failed: false,
    service: "bnl-discord-bot",
    statusCode: 200,
  });
}

async function runBnlFailureScenario(scenario) {
  const trace = createBnlTrace(scenario.name);

  for (const item of scenario.events) {
    await pause(12);
    addEvent(trace.traceId, item);
  }

  return finishTrace(trace.traceId, {
    failed: true,
    service: scenario.failureService,
    statusCode: scenario.statusCode,
    reason: scenario.reason,
  });
}

function createBnlTrace(name) {
  return createTrace({
    name,
    service: "chronoscope",
    metadata: {
      integration: "bnl-league",
      environment: "production",
      showcase: "BNL demo mode",
      successBaseline: BNL_SUCCESS_BASELINE,
    },
  });
}

function event(service, type, message, data, level = "info") {
  return { service, type, message, data, level };
}

function stripOffset(item) {
  const { offsetMs, ...eventWithoutOffset } = item;
  return eventWithoutOffset;
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

# Chronoscope

AI-powered black box recorder for backend and integration failures.

Chronoscope keeps request events in memory while a trace is running. If the trace succeeds, it is discarded. If it fails, the trace becomes an incident report with root cause analysis, evidence, comparison against a successful path, and suggested actions.

## Why It Exists

Most service traces are noisy. Chronoscope is a small prototype for a different debugging workflow: keep lightweight trace context while a request is active, then persist only the failed path and explain why it failed.

Chronoscope is not a Datadog, Grafana, Jaeger, OpenTelemetry, or log aggregation replacement. It is a black box recorder: successful executions disappear, failed executions become investigations.

## Features

- In-memory trace capture while a request is active
- Failed-trace replay persistence
- Successful-trace discard behavior
- Incident analysis generated at replay creation
- Root cause, confidence, impact, severity, automatic tags, and suggested actions
- Human-readable incident story
- Replay comparison against a successful baseline
- SQLite persistence for failed replay sessions
- API key authentication for API routes
- Timeline evidence with first-failure and causal-chain highlighting
- BNL demo mode with realistic W3Champions, Discord, snapshot sync, league update, and auth callback examples
- Basic sensitive-field redaction for tokens, passwords, cookies, authorization values, and secrets
- Node.js built-in test coverage

## Tech Stack

- Node.js 24+
- Native HTTP server
- `node:sqlite`
- Vanilla JavaScript frontend
- CSS
- `node:test`

## Project Structure

```text
chronoscope/
├── deploy/          Caddy reverse proxy config
├── docs/            Deployment and EC2 inspection runbook
├── public/          Browser UI
├── src/             Server, replay store, and demo scenario
├── test/            Store behavior tests
├── compose.yaml
├── Dockerfile
├── package.json
└── README.md
```

## Run Locally

```bash
npm start
```

Open:

```text
http://localhost:4177
```

Failed replay sessions are stored in SQLite. By default local runs use an in-memory database. To persist locally:

```bash
CHRONOSCOPE_DB_PATH=./data/chronoscope.sqlite npm start
```

Set `CHRONOSCOPE_API_KEY` to require `X-API-Key` or `Authorization: Bearer` authentication on `/api/*` routes.

## Run The Demo

With the server running, click **BNL Demo Incident** in the UI, or run:

```bash
npm run demo
```

The demo sends one successful BNL baseline and one failing W3Champions API timeout. Only the failing flow is persisted as an incident report.

## Test

```bash
npm test
```

## Deploy

Copy `.env.example` to `.env`, set a domain, ACME email, and long random API key, then run:

```bash
docker compose up -d --build
```

The Compose stack runs Chronoscope with automatic restarts, persists SQLite data in the `chronoscope-data` volume, and publishes HTTPS through Caddy. See [docs/deployment.md](docs/deployment.md) for the EC2 inspection checklist, cleanup plan, architecture diagram, and operations commands.

## Status

Prototype. The core behavior is working and covered by small tests. Good next steps would be trace import/export, richer filters, and a real SDK-style capture API.

## License

No license has been selected yet.

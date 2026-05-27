# Chronoscope

Capture-on-failure replay for microservices.

Chronoscope keeps request events in memory while a trace is running. If the trace succeeds, it is discarded. If it fails, the trace becomes a replay session that can be opened in the UI and inspected as a timeline.

## Why It Exists

Most service traces are noisy. Chronoscope is a small prototype for a different debugging workflow: keep lightweight trace context while a request is active, then persist only the failed path so developers can inspect what happened without storing every successful request.

## Features

- In-memory trace capture
- Failed-trace replay persistence
- Successful-trace discard behavior
- Timeline UI for inspecting service events
- Demo checkout scenario with one passing and one failing flow
- Basic sensitive-field redaction for tokens, passwords, cookies, authorization values, and secrets
- Node.js built-in test coverage

## Tech Stack

- Node.js 20+
- Native HTTP server
- Vanilla JavaScript frontend
- CSS
- `node:test`

## Project Structure

```text
chronoscope/
├── public/          Browser UI
├── src/             Server, replay store, and demo scenario
├── test/            Store behavior tests
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

## Run The Demo

With the server running, click **Run demo incident** in the UI, or run:

```bash
npm run demo
```

The demo sends one successful microservice flow and one failing flow. Only the failing flow is persisted as a replay.

## Test

```bash
npm test
```

## Status

Prototype. The core behavior is working and covered by small tests. Good next steps would be persistent storage, trace import/export, richer filters, and a real SDK-style capture API.

## License

No license has been selected yet.
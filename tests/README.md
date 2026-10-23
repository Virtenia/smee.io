# Tests

Use Node.js 24 or newer. Install dependencies and Chromium once:

```sh
npm ci
npx playwright install chromium
```

Run the complete active suite:

```sh
npm run lint
npm test
```

`npm test` builds production assets, runs the Node server integration tests, and
runs the Chromium browser tests. No Redis or external services are required.
The server starts in a child process with isolated environment settings and a
temporary local port; tests close their SSE clients and stop their servers.
The child process ignores the developer's `.env` file.

For quicker iterations after building assets:

```sh
npm run build:production
npm run test:server
npm run test:browser
```

Server tests cover the fork's raw-byte/base64 SSE protocol, not the published
`smee-client`, which does not implement this fork's protocol. They compare exact
payload bytes for JSON objects, arrays, strings, malformed JSON, CloudEvents,
forms, Unicode, and binary data; verify headers, query parameters, and channel
isolation; and cover redirects, proxy HTTPS handling, blocked channels, assets,
compression, request limits, and startup with Sentry enabled or disabled. Sentry
uses a dummy loopback DSN, never a real account.

Browser tests use real HTTP/SSE deliveries and the built React application.
They cover payload display, filtering, deduplication, persistence, pinning,
clearing, clipboard success/failure, and redelivery. Only the clipboard browser
API is mocked so permissions and completion can be controlled.

The suite replaces Enzyme snapshots, direct component state manipulation,
console-log assertions, and tests of third-party library details. CI runs lint
and the complete suite for PRs and pushes to `virtenia-fork` and `master`.

## Known application bug

The redelivery browser test runs as an **expected failure**. The UI currently
POSTs the entire decoded delivery envelope, and the server forwards that envelope
as the new body, with the browser's content type. The test requires the original
payload and content type. Setup, request delivery, and the success indicator
must still work before the expected-failure annotation is reached.

This is an existing product defect, not a skipped test or an assertion adjusted
to accept broken behavior. Fixing it should include deciding how to retain the
original raw bytes in the UI, so replay does not re-serialize JSON or invalidate
webhook signatures. Once fixed, Playwright reports an unexpected pass until the
annotation is removed. That production behavior change is separate from this
test renovation.

Redis scenarios and their original snapshot are preserved in
[`deferred/redis`](deferred/redis/README.md). They are intentionally excluded from
default test discovery and need porting before Redis is enabled again.

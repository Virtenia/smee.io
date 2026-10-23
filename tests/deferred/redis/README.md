# Deferred Redis tests

The original `event-bus.test.js` and its snapshot are preserved unchanged here.
They are excluded from `npm test` and lint; Redis is not needed by the active
suite or ordinary CI. The local delivery scenario is covered by HTTP/SSE tests.

The two Redis scenarios worth recovering are:

- Publishing a channel payload through Redis.
- Receiving a Redis publication and notifying the correct local channel.

These tests are historical references, not ready-to-run opt-in tests. They use
Jest, `emitEvent`, public `pub`/`sub` properties, and the old JSON wire format.
The current bus uses `emit(channel, payload)`, private connections, and messages
in the form `channel:JSON`. Do not simply restore the old snapshot expectations.

When Redis is used again, port the scenarios to Node's test runner, run a real
isolated Redis service, verify cross-instance delivery and namespace isolation,
and ensure connections close. Give those tests a separate explicit command/job.
`npm run redis:start` and `npm run redis:stop`, the Redis environment variables,
`ioredis`, and the application implementation remain available.

# Notification Handler — AWS Lambda (Node.js)

DEMO: https://www.loom.com/share/519f79dccd014dd197fa7000e8b7c3f4

An AWS Lambda function that processes a stream of semi-structured user events: it validates and normalizes each event and stores the result as a row in the MySQL `Notification` table (simulated by a dummy `insertToMySQL`). Invalid events are logged and skipped; the rest of the batch is processed without interruption.

The project has **zero dependencies** (Node.js ≥ 20 built-ins only) — no `npm install` needed.

```bash
node app/run.js --input sample/events.json --log-level INFO
```

Output (stdout; logs go to stderr):

```json
{
  "results": [
    {
      "index": 0,
      "type": "user_registered",
      "ok": true,
      "notification": {
        "NotificationID": 1,
        "NotificationTypeID": 1,
        "EventID": null,
        "NotificationData": {
          "type": "user_registered",
          "name": "Alice",
          "email": "alice@example.com",
          "roles": ["admin", "editor", "manager"],
          "joined": "2021-04-01T00:00:00.000Z"
        },
        "CreatedByType": 0,
        "CreatedByID": 0
      }
    },
    { "index": 1, "type": "user_registered", "ok": false, "error": "invalid_email", "message": "\"email\" is not a valid email address" },
    { "index": 4, "type": "unknown_type", "ok": false, "error": "unknown_type", "message": "unsupported event type: \"unknown_type\"" },
    { "index": 6, "type": "user_registered", "ok": false, "error": "duplicate_event", "message": "duplicate event_id \"dedupe-1\" (first stored occurrence wins)" }
  ],
  "stats": { "events": 7, "stored": 4, "rejected": 3, "failed": 0 }
}
```

(abridged — `results[i]` always mirrors `events[i]`, so callers can correlate by index.)

---

## Table of contents

- [Notification Handler — AWS Lambda (Node.js)](#notification-handler--aws-lambda-nodejs)
  - [Table of contents](#table-of-contents)
  - [Architecture](#architecture)
  - [Project layout](#project-layout)
  - [Local run](#local-run)
  - [Lambda event formats](#lambda-event-formats)
  - [Validation \& normalization rules](#validation--normalization-rules)
  - [Error handling](#error-handling)
  - [Database mapping](#database-mapping)
  - [AWS: build, local invoke, deploy](#aws-build-local-invoke-deploy)
  - [Testing](#testing)
  - [Extending: adding an event type](#extending-adding-an-event-type)

---

## Architecture

```
 events.json ──► app/run.js (CLI)        ─┐
                                          │   same core
 API Gateway ──► app/handler.js (Lambda) ─┤
 POST /events    (HTTP v2 or direct)      │
                                          ▼
                 ┌──────────────────────────────────────────────┐
                 │  src/pipeline.js — for each event:           │
                 │   1. look up `type` in the registry          │
                 │   2. dedupe on `event_id` (first wins)       │
                 │   3. definition.normalize(event)             │
                 │        └─ src/normalize.js (email/date/roles)│
                 │   4. toNotificationRow() → insert()          │
                 │   bad event / failed insert → per-event error │
                 └──────────────────────────────────────────────┘
                                          │
                 ┌────────────────────────▼─────────────────────┐
                 │  src/events/index.js — type registry          │
                 │   user_registered │ password_reset │ user_deleted │
                 │   { typeId, normalize(event) }                │
                 └──────────────────────────────────────────────┘
```

**Design principles**

- **One responsibility per module** — field normalizers, event definitions, the registry, DB mapping and orchestration are separate files; the CLI and Lambda handler are thin adapters over the same `processEvents()`.
- **Open for extension** — an event type is a small object `{ typeId, normalize }`. Adding one touches one new file and one registry line.
- **Fail-safe** — any `EventError` becomes a per-event result and a `WARN` log line; a failed insert becomes a per-event `storage_error`. Only real bugs fail the invocation.
- **Idempotent** — inserts are `INSERT IGNORE` against a `UNIQUE(EventID)` index, so a client can retry a whole batch after a `207`/`500` without creating duplicates.
- **No PII in errors or logs** — messages name the field and the rule, never the rejected value.
- **Deterministic** — dates are parsed from an explicit format allow-list (never the engine's `Date` string parser) and emitted as ISO 8601 UTC regardless of machine timezone.

## Project layout

```
app/
  handler.js              # Lambda entry point (HTTP API v2 or direct invocation)
  package.json            # { "type": "module" } — app/ is what gets deployed (CodeUri)
  run.js                  # Local CLI runner (simulates a Lambda invocation)
  src/
    pipeline.js           # Orchestration: type lookup → dedupe → normalize → insert
    normalize.js          # Field validators: email, date → ISO 8601, roles → string[]
    db.js                 # toNotificationRow() + dummy insertToMySQL()
    errors.js             # Typed errors with machine-readable codes
    logger.js             # JSON-lines logger with levels
    events/
      index.js            # Type registry — the only file to edit when adding a type
      user-registered.js
      password-reset.js
      user-deleted.js
sample/events.json        # The sample input from the spec (valid, invalid, duplicate)
events/                   # Ready-made events for `sam local invoke`
test/                     # 24 tests, node:test, zero dependencies
template.yaml             # SAM template (Lambda + IAM-authenticated HTTP API POST /events)
```

## Local run

```bash
node app/run.js --input sample/events.json --log-level INFO
node app/run.js --input sample/events.json --log-level DEBUG   # also prints the simulated SQL
node app/run.js --input sample/events.json > out.json          # results only; logs stay on stderr
node app/run.js --help
```

| Flag           | Description                                              |
| -------------- | -------------------------------------------------------- |
| `--input`      | JSON file: an array of events, or `{ "events": [...] }`  |
| `--log-level`  | `DEBUG` / `INFO` / `WARN` / `ERROR` (default `INFO`, or `$LOG_LEVEL`). Lambda uses `ApplicationLogLevel` instead |
| `--help`       | Print usage                                              |

Exit code `0` even when individual events are rejected (that is expected input). Exit code `1` only for fatal problems: missing/unreadable input, invalid JSON, unknown flags.

## Lambda event formats

| Invocation | Input | Output |
| --- | --- | --- |
| Direct (`aws lambda invoke`) | a bare JSON array of events, or `{ "events": [...] }` | `{ results, stats }` |
| API Gateway HTTP API (payload v2), `POST /events`, IAM-signed | same JSON in `body` (base64-aware), at most 1000 events | `200` with `{ results, stats }`; `207` when some events have `storage_error`; `400`/`413` `{ error, message }` for malformed or oversized bodies; `500` with a generic message for internal failures (details stay in the logs) |

## Validation & normalization rules

| Field | Rule | Error code |
| --- | --- | --- |
| `type` | must be registered in `src/events/index.js` | `unknown_type` |
| `event_id` (optional) | if present, a second event with the same id in the batch is rejected once the first one has been stored (an invalid first occurrence does not block a valid retry) | `duplicate_event` |
| `email` | trimmed, lower-cased, dot-atom local part and a dotted hostname with an alphabetic TLD (`a@b.c.`, `a@b..cc` are rejected) | `invalid_email` |
| date fields (`joined`, `requested`, `deleted`) | one of: `YYYY-MM-DD` / `YYYY/MM/DD`, optional `[T ]HH:mm[:ss[.sss]]`, optional zone (`Z`, `±hh:mm`, or `UTC`/`GMT`/US & central-European abbreviations); or `Month D[th][,] YYYY [HH:mm[:ss]] [zone]` (`April 5th, 2021 13:45 PST`). Zone-less input is UTC; impossible dates (`2021-02-30`), relative words and anything else are rejected. Output is ISO 8601 UTC | `invalid_date` |
| `roles` (user_registered) | comma-separated string, array of strings, or `null` → array of unique, trimmed, non-empty strings (`"admin, editor , manager"` → `["admin","editor","manager"]`, `["viewer"," "]` → `["viewer"]`, `null` → `[]`) | `invalid_roles` |
| any required string (`name`, …) | non-empty after trimming | `missing_field` |

Unknown extra fields are ignored; only normalized fields reach the database. Error messages never include the rejected value.

## Error handling

- **Per-event errors** (everything in the table above) are returned as `{ ok: false, error, message }` at the event's index, logged at `WARN`, counted in `stats.rejected`. Processing continues.
- **Request-level errors** (not an array, invalid JSON body) fail the invocation: HTTP `400 invalid_request` or a thrown `ValidationError` on direct invocation.
- **Storage errors** (DB insert throws) are per-event too: `{ ok: false, error: "storage_error" }`, logged at `ERROR`, counted in `stats.failed`; HTTP status becomes `207`. The client sees exactly which events were stored and can retry the whole batch, because inserts are idempotent on `event_id`.
- **Internal errors** (bugs) fail the invocation: HTTP `500` with a generic message; the stack is in the logs.

## Database mapping

`toNotificationRow()` in `app/src/db.js` maps a normalized event to the `Notification` table:

| Column | Value |
| --- | --- |
| `NotificationTypeID` | `typeId` from the registry (`1` user_registered, `2` password_reset, `3` user_deleted). Stable ids — never renumber |
| `EventID` | the event's `event_id` (trimmed) or `NULL`. **New column, see below** |
| `NotificationData` | JSON: `{ type, ...normalized fields }` |
| `CreatedByType` / `CreatedByID` | `0` / `0` (system). No actor is present in the events; set these when the producer starts sending one |
| `Status`, `Seen`, `IsBookmarked`, `Created` | left to the column defaults |

`insertToMySQL(row)` is a stub: it logs the parameterized `INSERT IGNORE` at `DEBUG` and returns a fake auto-increment id. Swap its body for a `mysql2` call; the row shape is the contract. The in-memory dedupe set only covers one batch; cross-invocation idempotency comes from the schema change below.

**Schema change required.** The handler assumes the `Notification` table has been extended with an `EventID` column and a unique index on it. Run this migration before deploying:

```sql
ALTER TABLE `Notification`
  ADD COLUMN `EventID` VARCHAR(255) NULL AFTER `NotificationTypeID`,
  ADD UNIQUE INDEX `uq_notification_event_id` (`EventID`);
```

`NULL` values are allowed multiple times by a MySQL unique index, so events without an `event_id` are always inserted. With the index in place, `INSERT IGNORE` turns a retried `event_id` into a no-op (`affectedRows = 0`) instead of a second row.

## AWS: build, local invoke, deploy

```bash
sam validate && sam build

# Local invocation (needs Docker)
sam local invoke NotificationHandlerFunction --event events/direct-event.json
sam local invoke NotificationHandlerFunction --event events/api-gateway-event.json

# Local HTTP API
sam local start-api
curl -s -X POST http://127.0.0.1:3000/events -H 'content-type: application/json' -d @sample/events.json   # auth is not enforced locally

# Deploy
sam deploy --guided            # first time; afterwards: sam deploy
```

The only configuration is the `LogLevel` template parameter, applied as Lambda's `ApplicationLogLevel`. The logger is the same JSON-lines module as in `classifier--summarizer`: in Lambda it emits via `console.*` so the JSON log format produces structured CloudWatch entries; the CLI writes JSON lines to stderr. The HTTP API requires IAM (SigV4) auth; the deployed function needs no AWS permissions beyond basic execution logging. Only `app/` is packaged.

## Testing

```bash
npm test                 # node:test, no install
npm run test:coverage
```

Covered: every normalizer against the spec's sample formats plus garbage inputs, timezone independence (the date suite re-runs under `TZ=America/New_York` and `Asia/Tokyo`), the pipeline on the full sample file (4 stored / 3 rejected, index alignment, no PII in logs), prototype-key event types, per-event storage errors, dedupe after an invalid first occurrence, registry extension, handler for direct / HTTP / base64 / malformed / oversized bodies and the 500 path, and the CLI's exit codes.

## Extending: adding an event type

1. Create `app/src/events/<type>.js`:

   ```js
   import { normalizeEmail, normalizeDate } from '../normalize.js';

   export default {
     typeId: 4, // next free NotificationTypeID — never reuse one
     normalize: (e) => ({
       email: normalizeEmail(e.email),
       changedAt: normalizeDate(e.changed_at, 'changed_at'),
     }),
   };
   ```

2. Register it in `app/src/events/index.js`:

   ```js
   import emailChanged from './email-changed.js';
   export const EVENT_TYPES = Object.freeze({ ..., email_changed: emailChanged });
   ```

That is the whole change. `normalize()` may use the shared helpers or any custom logic; throw an `EventError(message, code)` to reject an event. The pipeline, handler, CLI, DB mapping and the "unique typeIds" test pick the new type up automatically.

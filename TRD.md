# 📄 Technical Requirements Document (TRD)
### Time-Off Microservice — ExampleHR Platform
> **Version:** 1.1 &nbsp;|&nbsp; **Status:** Final &nbsp;|&nbsp; **Date:** April 2025

---

## Table of Contents
1. [Overview](#1-overview)
2. [Stakeholders & Personas](#2-stakeholders--personas)
3. [System Architecture](#3-system-architecture)
4. [Data Models](#4-data-models)
5. [REST API Design](#5-rest-api-design)
6. [Request Lifecycle & State Machine](#6-request-lifecycle--state-machine)
7. [HCM Sync Strategy](#7-hcm-sync-strategy)
8. [Key Challenges & Mitigations](#8-key-challenges--mitigations)
9. [Analysis of Alternatives Considered](#9-analysis-of-alternatives-considered)
10. [Testing Strategy](#10-testing-strategy)
11. [Technology Stack](#11-technology-stack)
12. [Open Questions](#12-open-questions)
13. [Glossary](#13-glossary)

---

## 1. Overview

This document describes the design of the **Time-Off Microservice** for ExampleHR — a backend service that manages the full lifecycle of employee time-off requests while maintaining balance integrity between ExampleHR and an external **Human Capital Management (HCM)** system (e.g., Workday, SAP).

The HCM is the authoritative source of truth for employment data. This service acts as a reliable intermediary: it caches balances locally, submits requests to the HCM, and handles all failure, retry, and reconciliation scenarios defensively.

### Goals
- Provide REST endpoints for creating, reading, updating, and cancelling time-off requests
- Maintain a local cache of leave balances **per employee per location**
- Sync balances bidirectionally with the HCM via real-time API calls and batch imports
- Handle HCM failures gracefully with retry logic, conflict resolution, and escalation workflows
- Enforce defensive balance validation even when HCM error responses are unreliable

### Non-Goals
- This service does not replace the HCM — it defers final authority to it
- It does not handle payroll, attendance, or non-leave HR data
- It does not provide a user interface (handled by the ExampleHR frontend)

---

## 2. Stakeholders & Personas

| Persona | Goal | Key Concern |
|---|---|---|
| **Employee** | Submit requests and see accurate real-time balances | Stale balance; request rejected after submission |
| **Manager** | Review requests knowing data is valid | Approving a request that exceeds balance |
| **HR Admin** | Manage balance overrides, batch syncs, and audit history | Data drift between ExampleHR and HCM going undetected |
| **System (HCM)** | Receive deductions and push balance updates | ExampleHR filing requests against invalid balances |

---

## 3. System Architecture

The microservice is a **NestJS** application backed by **SQLite via TypeORM**. It exposes REST endpoints consumed by the ExampleHR frontend and communicates with the HCM via outbound HTTP. Inbound HCM batch updates are received via a dedicated webhook endpoint.

```
┌──────────────────────────────────────────────────────────────┐
│                      ExampleHR Frontend                      │
└───────────────────────────┬──────────────────────────────────┘
                            │ REST
┌───────────────────────────▼──────────────────────────────────┐
│                  Time-Off Microservice (NestJS)               │
│                                                              │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────┐  │
│  │  BalanceModule  │  │ TimeOffRequest   │  │ HcmSync    │  │
│  │  (cache + TTL)  │  │ Module           │  │ Module     │  │
│  └────────┬────────┘  └────────┬─────────┘  └─────┬──────┘  │
│           │                   │                   │          │
│  ┌────────▼───────────────────▼───────────────────▼──────┐  │
│  │                    SQLite (TypeORM)                    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬───────────────────────────┘
                                   │ HTTP (Axios + Retry)
                    ┌──────────────▼──────────────┐
                    │        HCM System           │
                    │  (Workday / SAP / Mock)     │
                    └─────────────────────────────┘
```

### Core Modules

| Module | Responsibility |
|---|---|
| `BalanceModule` | CRUD on local leave balance cache; exposes balance query endpoints |
| `TimeOffRequestModule` | Manages request lifecycle: PENDING → APPROVED / REJECTED / CANCELLED |
| `HcmSyncModule` | Handles real-time HCM calls, batch import, retry, and reconciliation |
| `MockHcmModule` | Standalone mock HTTP server simulating HCM for testing |

---

## 4. Data Models

> **⚠️ Arithmetic Rule — DECIMAL ONLY:** All balance additions and subtractions **must** use fixed-point arithmetic via `decimal.js` or integer half-day units (multiply by 2 → operate in integers → divide by 2). Native JavaScript `number` arithmetic is **explicitly forbidden** for any balance mutation due to binary floating-point rounding (e.g. `0.1 + 0.2 !== 0.3`).

### `Employee`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Internal identifier |
| `name` | VARCHAR | Full name |
| `locationId` | VARCHAR | e.g. `"US-NYC"` |

### `LeaveBalance`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | |
| `employeeId` | UUID (FK) | References `Employee` |
| `locationId` | VARCHAR | Balance is per employee per location |
| `balance` | DECIMAL(10,2) | Current available days |
| `lastSyncedAt` | TIMESTAMP | `null` = unresolvably stale |

### `TimeOffRequest`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | |
| `employeeId` | UUID (FK) | References `Employee` |
| `locationId` | VARCHAR | Derived from employee record |
| `days` | DECIMAL(10,2) | Must be a positive multiple of `0.5`. DTO rejects any other value with HTTP 422. Half-day increments are universal — no location-specific rounding. |
| `status` | ENUM | HCM status: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`. **Source of truth for balance state.** |
| `manager_status` | ENUM | ExampleHR-only: `PENDING_REVIEW`, `MANAGER_APPROVED`, `MANAGER_REJECTED`. Independent from `status`. Never affects balance. |
| `hcmRef` | VARCHAR | Reference ID returned by HCM on approval |
| `createdAt` | TIMESTAMP | |
| `updatedAt` | TIMESTAMP | |

### `SyncLog`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | |
| `callType` | ENUM | `CREATION`, `CANCELLATION`, `BALANCE_SYNC`, `BATCH_SYNC` |
| `entityId` | UUID | ID of the affected `TimeOffRequest` or `LeaveBalance` |
| `status` | ENUM | `FAILED`, `ESCALATED`, `RESOLVED` |
| `errorMessage` | TEXT | Raw HCM error or timeout message |
| `attempts` | INTEGER | Attempts made before logging |
| `createdAt` | TIMESTAMP | |
| `resolvedAt` | TIMESTAMP | `null` until manually resolved |

### `BatchSyncLock`
| Field | Type | Notes |
|---|---|---|
| `employeeId` | UUID (PK) | Lock key — one per employee |
| `acquiredAt` | TIMESTAMP | Set at start of batch transaction; removed on commit or rollback |

---

## 5. REST API Design

### Balance Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/balances/:employeeId` | Fetch all balances for an employee |
| `GET` | `/balances/:employeeId/:locationId` | Fetch balance for a specific employee + location |
| `POST` | `/balances/sync/batch` | Receive a full HCM batch dump and upsert all records |
| `POST` | `/balances/sync/:employeeId/:locationId` | Trigger real-time HCM sync for one record |

### Time-Off Request Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/time-off` | Create a new request (validates balance, deducts tentatively, calls HCM) |
| `GET` | `/time-off/:id` | Fetch a specific request by ID |
| `GET` | `/time-off?employeeId=&status=` | List requests filtered by employee and/or status |
| `PATCH` | `/time-off/:id/approve` | Manager marks request as reviewed — **no HCM call, no balance change** |
| `PATCH` | `/time-off/:id/reject` | Manager rejects in ExampleHR — **does not undo HCM approval, does not restore balance** |
| `PATCH` | `/time-off/:id/cancel` | Employee cancels — triggers HCM cancellation flow and balance refund |

### Admin Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `PATCH` | `/admin/sync-log/:id/resolve` | HR Admin resolves an escalated SyncLog entry (`RETRY` / `OVERRIDE` / `DISCARD`) |

> **Role enforcement:** Only users with the `HR_ADMIN` role may call `/admin/*` endpoints. Manager-role users receive `HTTP 403`.

---

## 6. Request Lifecycle & State Machine

### ⚠️ Resolved Design Decision — HCM Submission Timing
> The HCM is called **immediately upon employee submission**, not upon manager approval. Manager approval is an ExampleHR-only workflow step and triggers **zero** HCM calls. Any implementation that delays the HCM call until manager approval is **incorrect**.

---

### Creation Flow (`POST /time-off`)

```
Step 1  ── Open DB transaction
           Acquire row-level lock on LeaveBalance(employeeId, locationId)
           (SELECT ... FOR UPDATE — NOT a table-level lock)

Step 2  ── Validate: if balance < requested days → HTTP 422, rollback, release lock
           No request record is created.

Step 3  ── Deduct tentatively (fixed-point arithmetic)
           Create TimeOffRequest with status = PENDING
           Commit transaction ← lock released here

           ⚠️  CRITICAL: The DB transaction MUST be fully committed and the
           queryRunner released BEFORE any network call is initiated.
           Never hold a DB lock across a network boundary — this causes deadlocks.

Step 4  ── Call HCM (outside DB transaction, with exponential backoff retry)
           Attempt 1: immediately
           Attempt 2: after 2 seconds
           Attempt 3: after 4 seconds

Step 5a ── HCM SUCCESS → new transaction: set status = APPROVED, store hcmRef
           (balance already deducted in step 3 — no further change)

Step 5b ── HCM REJECTION → new transaction: refund balance, set status = REJECTED
           (only fires on genuine HCM HTTP failure — never on DB errors)

Step 5c ── HCM TIMEOUT / MAX RETRIES EXHAUSTED → leave status = PENDING,
           balance stays deducted, log to SyncLog, auto-reject after 3 failures
           (see Retry Logic in §7.4)
```

---

### Manager Actions

| Action | Effect on `status` | Effect on `manager_status` | HCM Call | Balance Change |
|---|---|---|---|---|
| `PATCH /approve` | None | → `MANAGER_APPROVED` | ❌ | ❌ |
| `PATCH /reject` | None | → `MANAGER_REJECTED` | ❌ | ❌ |
| `PATCH /cancel` | → `CANCELLED` (if HCM confirms) | — | ✅ | Refund on HCM success |

> **⚠️ Manager rejection ≠ cancellation.** A manager rejection sets `manager_status = MANAGER_REJECTED` only. It does **not** undo the HCM approval and does **not** restore the balance. To reverse an HCM-approved request, the correct action is `PATCH /time-off/:id/cancel`.

> **UI display rule:** When `status = APPROVED` and `manager_status = MANAGER_REJECTED`, the API returns `effective_display_status: "APPROVED_HCM_REJECTED_MANAGER"`. UIs must render this explicitly — e.g. *"Approved in HCM, rejected by manager. To reverse the HCM approval, submit a cancellation."*

---

### Cancellation Flow (`PATCH /time-off/:id/cancel`)

| Current Status | Action |
|---|---|
| `PENDING` | Cancel locally (no HCM call). Refund balance + set `CANCELLED` atomically. |
| `APPROVED` | Call HCM first. **On success:** refund + set `CANCELLED` atomically. **On HCM failure/timeout:** leave as `APPROVED`, log to `SyncLog`, return HTTP 502. Do **not** auto-refund — the HCM has not acknowledged. |
| `REJECTED` / `CANCELLED` | Terminal — HTTP 422. |

> **Batch lock check:** If a `BatchSyncLock` exists for this `employeeId`, the cancellation must pause and retry after the batch commits. Cancellations must **never** write to `LeaveBalance` while a batch lock is active.

---

### Valid Status Transitions

```
(none) ──────────────────────────────────► PENDING
                                              │
                     ┌────────────────────────┼───────────────────────┐
                     ▼                        ▼                       ▼
                  APPROVED               REJECTED                CANCELLED
               (terminal HCM)          (terminal HCM)          (if PENDING, no HCM)
                     │
                     ▼
                CANCELLED (via explicit /cancel + HCM confirmation)
```

> **Enforcement rule:** A single shared `assertValidTransition(from, to)` guard must run before **every** status mutation. Any transition not in the table above throws `UnprocessableEntityException` (`HTTP 422`) with message `"Invalid status transition: {from} → {to}"`. This guard must **never** be bypassed.

---

## 7. HCM Sync Strategy

### 7.1 Real-Time Sync (TTL-Based)

On every balance read, the service checks `lastSyncedAt` on the specific `LeaveBalance` record for that `(employeeId, locationId)` pair.

- TTL staleness is evaluated **per record** — not globally
- Default TTL: **5 minutes**, configurable via `BALANCE_TTL_SECONDS` env var
- If `lastSyncedAt` is `null` **or** older than TTL → trigger background HCM sync asynchronously
- The cached value is returned immediately (stale-while-revalidate)
- Two employees at different locations have **independent TTL clocks**

### 7.2 Batch Sync (`POST /balances/sync/batch`)

The HCM pushes a full corpus of balances. This endpoint processes the payload atomically. The following sequence **must** execute in this exact order within a **single DB transaction**:

```
1. Acquire row-level locks (SELECT ... FOR UPDATE) on all PENDING TimeOffRequest rows
   whose employeeId appears in the batch payload.
   ⚠️ Row-level locks only — NOT a table-level lock. Table locks block all
   concurrent reads/writes and are explicitly forbidden.

2. Identify PENDING requests whose requested days would exceed the incoming
   HCM balance for that (employeeId, locationId).
   → Transition these to REJECTED with reason "HCM balance reconciliation"
   → Refund their tentative deductions

3. Upsert new HCM balance values into LeaveBalance.
   → HCM value always wins
   → Set lastSyncedAt = NOW() for every upserted record, even if previously null
   → Clear any stale_and_escalated flags for these records

4. Commit.
```

> **Batch rollback rule:** If the transaction fails at any step, it rolls back atomically. Requests that were transitioned to `REJECTED` in step 2 revert to `PENDING`. No manual compensation logic is needed — the single transaction guarantees this automatically. The batch is logged to `SyncLog` as `FAILED`, and the caller receives `HTTP 422` with the offending record identified.

### 7.3 Conflict Resolution

If a batch sync arrives and a balance is lower than the local cache (e.g. a request was filed directly in the HCM), **the HCM value always wins.** The reject-first, upsert-second order ensures no `PENDING` request is left referencing a balance that no longer exists.

### 7.4 Retry Logic

All outbound HCM calls use exponential backoff:

| Attempt | Delay |
|---|---|
| 1 | Immediate |
| 2 | 2 seconds |
| 3 | 4 seconds |

**After 3 failures:**

| Call Type | Behaviour |
|---|---|
| **Creation** | Auto-transition `PENDING` → `REJECTED`. Refund balance. Log to `SyncLog` with reason `"HCM unreachable after max retries"`. Return `HTTP 503` to caller. |
| **Cancellation of APPROVED** | Leave as `APPROVED`. Log to `SyncLog`. Return `HTTP 502`. Require manual HR Admin intervention. **Do not auto-refund.** |
| **Background balance sync** | Leave cached balance unchanged. Set `lastSyncedAt = null`. Log to `SyncLog`. Surface `stale_and_escalated: true` on next read. |

### 7.5 Batch vs Real-Time Sync Concurrency

- **Batch sync always wins.** It represents a full authoritative HCM snapshot.
- Before a real-time sync job writes a balance update, it checks `BatchSyncLock` for the `employeeId`. If a lock is present → abort write, re-enqueue after **10 seconds**.
- Cancellation flows are also subject to this rule — they must never write to `LeaveBalance` while a batch lock is active for that employee.
- The batch sync sets `BatchSyncLock` at transaction start and removes it on commit **or rollback**.
- Real-time sync jobs must **never** run in parallel for the same `(employeeId, locationId)` pair.

### 7.6 SyncLog Semantics

`SyncLog` is not a fire-and-forget audit trail — every entry is **actionable**.

- **Retention:** Minimum 90 days. Entries older than 90 days may be archived but never deleted.
- **Escalation:** If any `(employeeId, locationId)` pair accumulates **3 or more `FAILED` entries within a 1-hour window**, status upgrades to `ESCALATED`. The `GET /balances` response includes `stale_and_escalated: true` for affected records.
- **Escalation workflow — 3 admin actions (HR_ADMIN role only):**

| Action | Payload `action` value | Effect |
|---|---|---|
| **Retry** | `"RETRY"` | Fires a fresh HCM call. On success: marks `RESOLVED`, clears `stale_and_escalated`. |
| **Override** | `"OVERRIDE"` | Admin manually sets balance. Marks `RESOLVED` with reason `"admin override"`. Records `adminUserId` + timestamp. |
| **Discard** | `"DISCARD"` | Acknowledges failure, marks `RESOLVED` with reason `"admin discarded"`. No balance change. |

> **No escalated entry may be auto-resolved by the system.** Human acknowledgement is always required.

---

## 8. Key Challenges & Mitigations

| Challenge | Risk | Mitigation |
|---|---|---|
| **HCM balance changes independently** | Local cache becomes stale | TTL-based staleness per `(employeeId, locationId)` record; batch sync endpoint for full refresh |
| **HCM may not return errors reliably** | Invalid requests silently succeed | Defensive pre-validation against local balance before every HCM submission |
| **Race conditions on deduction** | Two concurrent requests both pass validation but together exceed balance | Row-level `SELECT ... FOR UPDATE` lock acquired before validation; deduction and request creation committed atomically before HCM call |
| **HCM temporarily unavailable** | Requests cannot be processed | Exponential backoff retry (3 attempts); auto-reject creation requests after exhaustion; cancellations blocked until HCM confirms |
| **Batch sync mid-flight with active request** | Batch update overwrites a just-deducted balance | Batch applies row-level locks on PENDING requests; rejects conflicts before upserting new balances; single atomic transaction |
| **Floating-point arithmetic drift** | Balance silently corrupts over many operations | `decimal.js` or integer half-day arithmetic mandatory for all balance mutations; native `number` operations forbidden |
| **DB lock held during network call** | Deadlocks under concurrent load | DB transaction committed and `queryRunner` released before HCM HTTP call is initiated — enforced by code structure |

---

## 9. Analysis of Alternatives Considered

### 9.1 Always-Defer to HCM (No Local Cache)
Every balance read calls HCM in real time with no local storage.
- ✅ Always perfectly accurate
- ❌ High latency; complete unavailability if HCM is down
- **Decision: Rejected.** Local cache with TTL-based refresh gives acceptable accuracy with significantly better resilience.

### 9.2 Event-Driven Sync (Message Queue)
Use a message broker (e.g. RabbitMQ, Kafka) to stream HCM balance change events.
- ✅ Near real-time accuracy; decoupled architecture
- ❌ Significant infrastructure complexity; message ordering and deduplication non-trivial
- **Decision: Deferred.** Can be adopted in a future version if polling/batch proves insufficient at scale.

### 9.3 PostgreSQL Instead of SQLite
Use a production-grade relational database.
- ✅ Better concurrency, scalable, native JSON operators
- ❌ Heavier infrastructure; exercise specifies SQLite
- **Decision: SQLite used per requirements.** TypeORM makes a future migration trivial.

### 9.4 HCM Submission Timing — On Manager Approval
Delay the HCM call until a manager approves rather than on employee submission.
- ✅ Manager has veto power before balance is touched
- ❌ Balance could change between submission and approval, causing drift; poorer UX (employee waits on manager before getting a decision)
- **Decision: Rejected.** HCM called immediately on employee submission. Manager approval is ExampleHR-only metadata.

### 9.5 Seeding Method — SQL Scripts vs REST Controller
Using SQL scripts vs a `SeedController` for test data.
- ✅ SQL scripts are faster and don't require a running server
- ❌ Require reviewers to have local SQLite CLI tools installed
- **Decision: REST Seed Controller.** Allows population via standard HTTP tools with zero local tooling required.

---

## 10. Testing Strategy

### 10.1 Unit Tests
Each service class and helper tested in isolation with **Jest**:
- `BalanceMath` — deduct, refund, edge cases (0.5 increments, zero balance, max value)
- `StateMachine.assertValidTransition` — all valid and all invalid transitions
- Retry helper — correct delay sequence, throws after max attempts
- `SyncLog` escalation threshold logic

### 10.2 Integration Tests (E2E)
Full NestJS e2e tests against an in-memory SQLite database and a **live mock HCM server**:

| Scenario | Expected Outcome |
|---|---|
| Happy path: submit → HCM confirms | `APPROVED`, balance deducted |
| Insufficient balance | `HTTP 422` before HCM is called |
| HCM rejects | `REJECTED`, balance refunded atomically |
| HCM times out (3 retries) | `REJECTED`, balance refunded, `SyncLog` entry created |
| Cancel `APPROVED` request | HCM notified, balance refunded, `CANCELLED` |
| Cancel `APPROVED` — HCM fails | Stays `APPROVED`, `HTTP 502` returned, balance untouched |
| Concurrent requests against same balance | Only one succeeds; second gets `HTTP 422` |
| Batch sync — conflict with `PENDING` | Conflict → `REJECTED`, new balance upserted |
| Batch sync rollback | All changes reverted atomically; `PENDING` requests stay `PENDING` |
| Manager rejects an `APPROVED` request | `manager_status = MANAGER_REJECTED`, HCM status unchanged, balance unchanged |
| TTL expired — balance read | Background refresh triggered, stale value returned immediately |

### 10.3 Mock HCM Server
A lightweight Express server deployed as part of the test suite:
- Maintains an in-memory balance store
- Supports real-time `GET`/`POST` balance endpoints and batch dump endpoint
- Configurable to simulate: success, rejection, delay, partial failure, and timeout
- Can be seeded with specific balances per test case

### 10.4 Coverage Target
**Minimum 80% line coverage** across all modules, enforced via Jest `coverageThresholds` in CI.

---

## 11. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js 20 + TypeScript | Type safety; matches ExampleHR frontend ecosystem |
| Framework | NestJS | Modular, excellent DI and testing support |
| Database | SQLite via TypeORM | Lightweight, zero-config, specified by requirements |
| HTTP Client | Axios (`@nestjs/axios`) | Retry/interceptor support for HCM calls |
| Decimal Arithmetic | `decimal.js` | Prevents floating-point drift in all balance operations |
| Testing | Jest + Supertest | Industry standard; integrates natively with NestJS CLI |
| Mock Server | Express (in test suite) | Minimal overhead for simulating HCM endpoints |
| Validation | `class-validator` + `class-transformer` | DTO-level request validation |

---

## 12. Open Questions

- Should partial-day requests be supported beyond `0.5` increments? *(Current: 0.5 minimum, universal)*
- Is there an SLA for HCM availability? *(Affects retry timeout and `BALANCE_TTL_SECONDS` defaults)*
- Should the service expose a WebSocket or SSE endpoint for real-time balance updates to the frontend?
- Should `SyncLog` entries trigger external alerting (e.g. PagerDuty, Slack) on escalation, or is the `stale_and_escalated` API flag sufficient?

---

## 13. Glossary

| Term | Definition |
|---|---|
| **HCM** | Human Capital Management system (e.g. Workday, SAP). Source of truth for HR data. |
| **Balance** | The number of leave days available to an employee at a given location. |
| **TTL** | Time-to-live: duration after which a cached balance is considered stale. |
| **Batch Sync** | A full dump of all balances from HCM sent to ExampleHR in a single payload. |
| **Row-Level Lock** | A `SELECT ... FOR UPDATE` lock on a specific DB row, preventing concurrent writes to that row only. |
| **hcmRef** | A reference ID returned by HCM when a time-off request is successfully filed. |
| **assertValidTransition** | A shared guard function that enforces the status state machine. Throws HTTP 422 for any unlisted transition. |
| **stale_and_escalated** | A response flag indicating a balance record has unresolved HCM sync failures and requires HR Admin intervention. |
| **effective_display_status** | A derived API field returned when `status` and `manager_status` conflict, e.g. `"APPROVED_HCM_REJECTED_MANAGER"`. |

---

*ExampleHR Time-Off Microservice — TRD v1.1*

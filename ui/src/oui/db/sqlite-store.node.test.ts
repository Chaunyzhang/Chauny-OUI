// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { OUI_DB_LATEST_SCHEMA_VERSION, runOuiMigrations } from "./migrations.ts";
import { OuiSqliteRunStore } from "./sqlite-store.ts";

let stores: OuiSqliteRunStore[] = [];
let databases: DatabaseSync[] = [];

function createStore() {
  const db = new DatabaseSync(":memory:");
  runOuiMigrations(db);
  const store = new OuiSqliteRunStore(db, { maxLogsPerRun: 2, maxLogLength: 80 });
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores) {
    store.close();
  }
  stores = [];
  for (const db of databases) {
    db.close();
  }
  databases = [];
});

describe("OUI SQLite migrations", () => {
  it("are idempotent", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);

    runOuiMigrations(db);
    runOuiMigrations(db);

    const row = db.prepare("SELECT COUNT(*) AS count FROM oui_schema_migrations").get() as {
      count: number;
    };
    expect(row.count).toBe(OUI_DB_LATEST_SCHEMA_VERSION);
  });
});

describe("OUI SQLite run leases", () => {
  it("claims a queued run once, heartbeats it, and finishes idempotently", async () => {
    const store = createStore();
    const run = await store.enqueueRun({
      id: "run_once",
      adapterId: "openclaw-local",
      adapterKind: "openclaw",
      sessionKey: "main",
      input: { sessionKey: "main", message: "hello" },
      maxAttempts: 1,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    expect(run.status).toBe("queued");
    const firstClaim = await store.claimNextRun({
      workerId: "worker-a",
      leaseMs: 30_000,
      now: new Date("2026-05-10T00:00:01.000Z"),
    });
    const secondClaim = await store.claimNextRun({
      workerId: "worker-b",
      leaseMs: 30_000,
      now: new Date("2026-05-10T00:00:01.000Z"),
    });

    expect(firstClaim?.run.id).toBe("run_once");
    expect(secondClaim).toBeNull();

    const heartbeat = await store.heartbeatRunLease({
      runId: "run_once",
      workerId: "worker-a",
      leaseToken: firstClaim!.leaseToken,
      leaseMs: 30_000,
      now: new Date("2026-05-10T00:00:10.000Z"),
    });
    expect(heartbeat?.leaseOwner).toBe("worker-a");

    const started = await store.startLeasedRun({
      runId: "run_once",
      workerId: "worker-a",
      leaseToken: firstClaim!.leaseToken,
      now: new Date("2026-05-10T00:00:11.000Z"),
    });
    expect(started?.status).toBe("running");

    await store.appendLog({
      runId: "run_once",
      level: "info",
      message: "using Authorization: Bearer abcdefghijklmnop1234567890",
    });
    await store.appendLog({ runId: "run_once", level: "info", message: "second" });
    await store.appendLog({ runId: "run_once", level: "info", message: "third" });
    const logs = await store.listLogs("run_once");
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe("second");

    const finished = await store.finishRun({
      runId: "run_once",
      workerId: "worker-a",
      leaseToken: firstClaim!.leaseToken,
      status: "succeeded",
      result: { ok: true },
      now: new Date("2026-05-10T00:00:12.000Z"),
    });
    const finishedAgain = await store.finishRun({
      runId: "run_once",
      workerId: "worker-a",
      leaseToken: firstClaim!.leaseToken,
      status: "failed",
      error: "should not replace terminal result",
      now: new Date("2026-05-10T00:00:13.000Z"),
    });

    expect(finished?.status).toBe("succeeded");
    expect(finishedAgain?.status).toBe("succeeded");
    expect(finishedAgain?.result).toEqual({ ok: true });
  });

  it("recovers expired leases by requeueing retryable runs and failing exhausted runs", async () => {
    const store = createStore();
    await store.enqueueRun({
      id: "run_retry",
      adapterId: "openclaw-local",
      adapterKind: "openclaw",
      input: { sessionKey: "main", message: "retry" },
      maxAttempts: 2,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    const firstClaim = await store.claimNextRun({
      workerId: "worker-a",
      leaseMs: 100,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    const firstRecovery = await store.recoverExpiredLeases({
      now: new Date("2026-05-10T00:00:01.000Z"),
    });
    expect(firstRecovery).toEqual({ inspected: 1, requeued: 1, failed: 0 });
    expect(
      await store.finishRun({
        runId: "run_retry",
        workerId: "worker-a",
        leaseToken: firstClaim!.leaseToken,
        status: "succeeded",
        now: new Date("2026-05-10T00:00:01.000Z"),
      }),
    ).toBeNull();

    await store.claimNextRun({
      workerId: "worker-b",
      leaseMs: 100,
      now: new Date("2026-05-10T00:00:02.000Z"),
    });
    const secondRecovery = await store.recoverExpiredLeases({
      now: new Date("2026-05-10T00:00:03.000Z"),
    });
    const recovered = await store.getRun("run_retry");

    expect(secondRecovery).toEqual({ inspected: 1, requeued: 0, failed: 1 });
    expect(recovered?.status).toBe("failed");
    expect(recovered?.error).toBe("Run lease expired.");
  });
});

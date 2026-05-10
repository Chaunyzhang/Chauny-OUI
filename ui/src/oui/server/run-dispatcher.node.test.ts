// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createOuiAdapterRegistry } from "../adapters/registry.ts";
import { runOuiMigrations } from "../db/migrations.ts";
import { OuiSqliteRunStore } from "../db/sqlite-store.ts";
import { createDefaultOuiFeatureFlags } from "../shared/feature-flags.ts";
import type { OuiAdapterModule } from "../shared/types.ts";
import { OuiRunDispatcher } from "./run-dispatcher.ts";

let stores: OuiSqliteRunStore[] = [];

function createStore() {
  const db = new DatabaseSync(":memory:");
  runOuiMigrations(db);
  const store = new OuiSqliteRunStore(db);
  stores.push(store);
  return store;
}

function createAdapter(overrides: Partial<OuiAdapterModule> = {}): OuiAdapterModule {
  return {
    id: "fake-local",
    kind: "fake",
    label: "Fake",
    capabilities: {
      execute: "available",
      cancel: "missing",
      streamEvents: "missing",
      listModels: "missing",
      listAgents: "missing",
      listSkills: "missing",
      usageQuery: "missing",
      localRuntime: "available",
      externalExecution: false,
    },
    async testConnection() {
      return { ok: true, status: "connected" };
    },
    async execute(ctx) {
      await ctx.log("info", "fake complete");
      return { status: "succeeded", summary: "done", resultJson: { done: true } };
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const store of stores) {
    store.close();
  }
  stores = [];
});

describe("OuiRunDispatcher", () => {
  it("executes one queued run through a registered adapter", async () => {
    const store = createStore();
    await store.enqueueRun({
      id: "run_dispatch",
      adapterId: "fake-local",
      adapterKind: "fake",
      input: {},
    });
    const registry = createOuiAdapterRegistry([createAdapter()]);
    const dispatcher = new OuiRunDispatcher({
      store,
      registry,
      flags: createDefaultOuiFeatureFlags(),
      workerId: "worker-a",
    });

    const result = await dispatcher.dispatchOnce();
    const run = await store.getRun("run_dispatch");
    const logs = await store.listLogs("run_dispatch");

    expect(result.status).toBe("finished");
    expect(run?.status).toBe("succeeded");
    expect(run?.result?.resultJson).toEqual({ done: true });
    expect(logs.map((log) => log.message)).toContain("fake complete");
  });

  it("blocks process adapters before the safety gate is enabled", async () => {
    const store = createStore();
    await store.enqueueRun({
      id: "run_blocked",
      adapterId: "process-local",
      adapterKind: "process",
      input: {},
    });
    const registry = createOuiAdapterRegistry([
      createAdapter({
        id: "process-local",
        kind: "process",
        capabilities: {
          ...createAdapter().capabilities,
          externalExecution: true,
        },
      }),
    ]);
    const dispatcher = new OuiRunDispatcher({
      store,
      registry,
      flags: createDefaultOuiFeatureFlags(),
      workerId: "worker-a",
      adapterAllowlist: ["process-local"],
    });

    const result = await dispatcher.dispatchOnce();
    const run = await store.getRun("run_blocked");

    expect(result.status).toBe("blocked");
    expect(run?.status).toBe("blocked");
    expect(run?.error).toContain("External adapter execution is disabled");
  });
});

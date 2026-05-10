// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createOuiAdapterRegistry } from "../adapters/registry.ts";
import { runOuiMigrations } from "../db/migrations.ts";
import { OuiSqliteProductStore } from "../db/sqlite-product-store.ts";
import { OuiSqliteRunStore } from "../db/sqlite-store.ts";
import { createDefaultOuiFeatureFlags } from "../shared/feature-flags.ts";
import type { OuiAdapterModule } from "../shared/types.ts";
import { OuiCompanyService } from "./company-service.ts";

let databases: DatabaseSync[] = [];

function createStores() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  runOuiMigrations(db);
  return {
    productStore: new OuiSqliteProductStore(db),
    runStore: new OuiSqliteRunStore(db),
  };
}

function adapter(id: string, kind: OuiAdapterModule["kind"]): OuiAdapterModule {
  return {
    id,
    kind,
    label: id,
    capabilities: {
      execute: "available",
      cancel: "missing",
      streamEvents: "missing",
      listModels: "missing",
      listAgents: "missing",
      listSkills: "missing",
      usageQuery: "missing",
      localRuntime: "available",
      externalExecution: kind !== "openclaw",
    },
    async testConnection() {
      return { ok: true, status: "connected" };
    },
    async execute() {
      return { status: "succeeded" };
    },
  };
}

afterEach(() => {
  for (const db of databases) {
    db.close();
  }
  databases = [];
});

describe("OuiCompanyService", () => {
  it("queues ready tasks through the OpenClaw leader and builds a timeline", async () => {
    const { productStore, runStore } = createStores();
    await productStore.createCompany({
      id: "company_1",
      name: "Test Company",
      openclawCeo: {
        id: "leader_1",
        label: "Lead",
        openclawAgentId: "main",
      },
    });
    await productStore.createTask({
      id: "task_1",
      companyId: "company_1",
      title: "Ship P1",
      assignedAgentId: "leader_1",
    });
    const service = new OuiCompanyService({
      productStore,
      runStore,
      registry: createOuiAdapterRegistry([adapter("openclaw-local", "openclaw")]),
      flags: createDefaultOuiFeatureFlags(),
    });

    const result = await service.queueTaskRun({
      taskId: "task_1",
      runId: "run_task_1",
      sessionKey: "main",
      message: "Do work",
    });
    await runStore.appendLog({ runId: "run_task_1", level: "info", message: "started" });
    const run = await runStore.getRun("run_task_1");
    await service.recordRunCostFromResult("task_1", {
      ...run!,
      result: { usage: { inputTokens: 3 }, cost: { usd: 0.01, currency: "USD" } },
    });
    const timeline = await service.getTaskTimeline("task_1");

    expect(result.status).toBe("queued");
    expect(timeline.task.status).toBe("running");
    expect(timeline.runs[0].run?.id).toBe("run_task_1");
    expect(timeline.runs[0].logs[0].message).toBe("started");
    expect(timeline.runs[0].costEvents[0]).toMatchObject({
      amountMicros: 10000,
      currency: "USD",
    });
  });

  it("keeps external employee adapters preview-only until the safety gate allows them", () => {
    const { productStore, runStore } = createStores();
    const service = new OuiCompanyService({
      productStore,
      runStore,
      registry: createOuiAdapterRegistry([
        adapter("openclaw-local", "openclaw"),
        adapter("codex-local", "codex"),
      ]),
      flags: createDefaultOuiFeatureFlags(),
    });

    const previews = service.listEmployeeAdapterPreviews();

    expect(previews.find((entry) => entry.adapterId === "openclaw-local")).toMatchObject({
      executable: true,
    });
    expect(previews.find((entry) => entry.adapterId === "codex-local")).toMatchObject({
      executable: false,
      reason: "External adapter execution is disabled.",
    });
  });
});

// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { runOuiMigrations } from "./migrations.ts";
import { OuiSqliteProductStore } from "./sqlite-product-store.ts";
import { OuiSqliteRunStore } from "./sqlite-store.ts";

let databases: DatabaseSync[] = [];

function createStore() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  runOuiMigrations(db);
  return new OuiSqliteProductStore(db);
}

afterEach(() => {
  for (const db of databases) {
    db.close();
  }
  databases = [];
});

describe("OuiSqliteProductStore company and agents", () => {
  it("creates a default company with an OpenClaw leader mapping", async () => {
    const store = createStore();

    const { company, leader } = await store.ensureDefaultCompany({
      companyId: "company_1",
      name: "Chauny OUI",
      openclawLeader: {
        id: "leader_1",
        label: "Lead",
        openclawAgentId: "openclaw-main",
      },
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    expect(company.defaultLeaderAgentId).toBe("leader_1");
    expect(leader).toMatchObject({
      id: "leader_1",
      adapterKind: "openclaw",
      openclawAgentId: "openclaw-main",
      isLeader: true,
      status: "active",
    });
  });

  it("defaults non-OpenClaw employees to disabled and prevents reports-to cycles", async () => {
    const store = createStore();
    await store.ensureDefaultCompany({
      companyId: "company_1",
      openclawLeader: { id: "leader_1" },
    });

    const employee = await store.createAgent({
      id: "employee_1",
      companyId: "company_1",
      adapterId: "codex-local",
      adapterKind: "codex",
      label: "Codex Employee",
      reportsToAgentId: "leader_1",
    });

    expect(employee.status).toBe("disabled");
    await expect(
      store.createAgent({
        id: "leader_1",
        companyId: "company_1",
        adapterId: "openclaw-local",
        adapterKind: "openclaw",
        label: "Lead",
        reportsToAgentId: "employee_1",
        status: "active",
      }),
    ).rejects.toThrow(/cycle/);
  });
});

describe("OuiSqliteProductStore tasks", () => {
  it("tracks assignment readiness through dependencies and review transitions", async () => {
    const store = createStore();
    await store.ensureDefaultCompany({
      companyId: "company_1",
      openclawLeader: { id: "leader_1" },
    });
    const dependency = await store.createTask({
      id: "task_dependency",
      companyId: "company_1",
      title: "Prepare context",
    });
    const task = await store.createTask({
      id: "task_main",
      companyId: "company_1",
      title: "Build feature",
    });
    await store.addTaskDependency(task.id, dependency.id);

    const assigned = await store.assignTask(task.id, "leader_1");
    expect(assigned.status).toBe("blocked");
    expect(await store.getTaskReadiness(task.id)).toEqual({
      ready: false,
      pendingDependencyIds: ["task_dependency"],
    });

    await store.updateTaskStatus(dependency.id, "done");
    const ready = await store.assignTask(task.id, "leader_1");
    expect(ready.status).toBe("ready");

    const review = await store.transitionTaskReview(task.id, "requested");
    expect(review).toMatchObject({ status: "review", reviewState: "requested" });
    const changes = await store.transitionTaskReview(task.id, "changes_requested");
    expect(changes.reviewState).toBe("changes_requested");
    await expect(store.transitionTaskReview(task.id, "approved")).rejects.toThrow(/Invalid/);
  });

  it("rejects dependency cycles", async () => {
    const store = createStore();
    await store.ensureDefaultCompany({ companyId: "company_1" });
    await store.createTask({ id: "task_a", companyId: "company_1", title: "A" });
    await store.createTask({ id: "task_b", companyId: "company_1", title: "B" });
    await store.addTaskDependency("task_a", "task_b");

    await expect(store.addTaskDependency("task_b", "task_a")).rejects.toThrow(/cycle/);
  });
});

describe("OuiSqliteProductStore task run and cost links", () => {
  it("links runs and cost events to tasks", async () => {
    const store = createStore();
    const runStore = new OuiSqliteRunStore(databases[databases.length - 1]);
    await store.ensureDefaultCompany({
      companyId: "company_1",
      openclawLeader: { id: "leader_1" },
    });
    await store.createTask({ id: "task_1", companyId: "company_1", title: "Work" });
    await runStore.enqueueRun({
      id: "run_1",
      adapterId: "openclaw-local",
      adapterKind: "openclaw",
      input: { sessionKey: "main", message: "Work" },
    });

    const link = await store.attachRunToTask("task_1", "run_1", "primary");
    const cost = await store.recordCostEvent({
      runId: "run_1",
      taskId: "task_1",
      agentId: "leader_1",
      amountMicros: 1234,
      currency: "USD",
      usage: { inputTokens: 10 },
      source: "run_result",
    });

    expect(link).toMatchObject({ taskId: "task_1", runId: "run_1", kind: "primary" });
    expect(await store.listCostEventsForRun("run_1")).toEqual([cost]);
  });
});

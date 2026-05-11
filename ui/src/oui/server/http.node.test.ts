import { readFile, rm } from "node:fs/promises";
import * as path from "node:path";
// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createOuiAdapterRegistry } from "../adapters/registry.ts";
import { runOuiMigrations } from "../db/migrations.ts";
import { OuiSqliteProductStore } from "../db/sqlite-product-store.ts";
import { OuiSqliteRunStore } from "../db/sqlite-store.ts";
import { createDefaultOuiFeatureFlags } from "../shared/feature-flags.ts";
import type {
  OuiAdapterExecutionContext,
  OuiAdapterExecutionResult,
  OuiAdapterModule,
} from "../shared/types.ts";
import { createOuiHttpServer, type OuiHttpServer } from "./http.ts";
import { OuiRunDispatcher } from "./run-dispatcher.ts";

let stores: OuiSqliteRunStore[] = [];
let servers: OuiHttpServer[] = [];
let artifactRoots: string[] = [];

function createStore() {
  const db = new DatabaseSync(":memory:");
  runOuiMigrations(db);
  const store = new OuiSqliteRunStore(db);
  stores.push(store);
  return store;
}

function createStores() {
  const db = new DatabaseSync(":memory:");
  runOuiMigrations(db);
  const store = new OuiSqliteRunStore(db);
  stores.push(store);
  return { store, productStore: new OuiSqliteProductStore(db) };
}

function createAdapter(
  id = "openclaw-local",
  kind: OuiAdapterModule["kind"] = "openclaw",
  onExecute?: (ctx: OuiAdapterExecutionContext) => void,
  executeOverride?: (ctx: OuiAdapterExecutionContext) => Promise<OuiAdapterExecutionResult>,
): OuiAdapterModule {
  return {
    id,
    kind,
    label: id,
    capabilities: {
      execute: "available",
      cancel: "available",
      streamEvents: "available",
      listModels: "available",
      listAgents: "available",
      listSkills: "missing",
      usageQuery: "manual",
      localRuntime: "available",
      externalExecution: kind !== "openclaw",
    },
    async testConnection() {
      return { ok: true, status: "connected" };
    },
    async execute(ctx) {
      onExecute?.(ctx);
      if (executeOverride) {
        return executeOverride(ctx);
      }
      return {
        status: "succeeded",
        summary: "Adapter finished.",
        resultJson: { text: "Adapter output." },
      };
    },
  };
}

afterEach(async () => {
  for (const server of servers) {
    await server.close();
  }
  servers = [];
  const workspaceRoot = path.resolve(process.cwd());
  for (const root of artifactRoots) {
    const resolved = path.resolve(root);
    if (resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
      await rm(resolved, { recursive: true, force: true });
    }
  }
  artifactRoots = [];
  for (const store of stores) {
    store.close();
  }
  stores = [];
});

function createArtifactRoot(name: string): string {
  const workspaceRoot = path.resolve(process.cwd());
  const root = path.resolve(workspaceRoot, ".artifacts", name);
  if (!root.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`Refusing to use artifact root outside workspace: ${root}`);
  }
  artifactRoots.push(root);
  return root;
}

describe("OUI HTTP server", () => {
  it("boots on an explicit local listener and serves health", async () => {
    const server = createOuiHttpServer({
      store: createStore(),
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    const response = await fetch(`http://127.0.0.1:${port}/api/oui/health`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, service: "oui", queueEnabled: true });
  });

  it("enqueues and reads OpenClaw-backed run records without Gateway state", async () => {
    const server = createOuiHttpServer({
      store: createStore(),
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/oui/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "run_http",
        adapterId: "openclaw-local",
        adapterKind: "openclaw",
        sessionKey: "main",
        input: { sessionKey: "main", message: "hello" },
      }),
    });
    const created = (await createResponse.json()) as { run?: { id?: string; status?: string } };

    expect(createResponse.status).toBe(202);
    expect(created.run).toMatchObject({ id: "run_http", status: "queued" });

    const readResponse = await fetch(`http://127.0.0.1:${port}/api/oui/runs/run_http`);
    const read = (await readResponse.json()) as { run?: { id?: string; status?: string } };

    expect(readResponse.status).toBe(200);
    expect(read.run).toMatchObject({ id: "run_http", status: "queued" });
  });

  it("creates company tasks and queues task runs through OUI APIs", async () => {
    const { store, productStore } = createStores();
    const observedRunInputs: Array<Record<string, unknown>> = [];
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([
        createAdapter("openclaw-local", "openclaw", (ctx) => {
          observedRunInputs.push(ctx.run.input);
        }),
      ]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    const companyResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_1",
        name: "Test Company",
        openclawLeader: {
          id: "leader_1",
          label: "Lead",
          openclawAgentId: "main",
        },
      }),
    });
    expect(companyResponse.status).toBe(201);

    const employeeResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_1/agents`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "worker_1",
          adapterId: "openclaw-local",
          adapterKind: "openclaw",
          label: "Worker",
          reportsToAgentId: "leader_1",
          openclawAgentId: "worker",
        }),
      },
    );
    expect(employeeResponse.status).toBe(201);

    const taskResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_1/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "task_1", title: "Coordinate work" }),
    });
    expect(taskResponse.status).toBe(201);

    const assignResponse = await fetch(`http://127.0.0.1:${port}/api/oui/tasks/task_1/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "worker_1" }),
    });
    expect(assignResponse.status).toBe(200);

    const companyReadResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_1`);
    const companyReadBody = (await companyReadResponse.json()) as {
      tasks?: Array<{ id?: string }>;
    };
    expect(companyReadResponse.status).toBe(200);
    expect(companyReadBody.tasks?.map((task) => task.id)).toEqual(["task_1"]);

    const runResponse = await fetch(`http://127.0.0.1:${port}/api/oui/tasks/task_1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "run_task_1", message: "Do it" }),
    });
    const runBody = (await runResponse.json()) as {
      status?: string;
      run?: { id?: string; sessionKey?: string; input?: Record<string, unknown> };
    };
    expect(runResponse.status).toBe(200);
    expect(runBody).toMatchObject({
      status: "queued",
      run: {
        id: "run_task_1",
        sessionKey: "agent:worker:main",
        status: "succeeded",
        input: { sessionKey: "agent:worker:main", message: "Do it" },
      },
    });
    expect(observedRunInputs[0]).toMatchObject({
      sessionKey: "agent:worker:main",
      message: "Do it",
    });

    const timelineResponse = await fetch(`http://127.0.0.1:${port}/api/oui/tasks/task_1/timeline`);
    const timeline = (await timelineResponse.json()) as { runs?: Array<{ run?: { id?: string } }> };
    expect(timelineResponse.status).toBe(200);
    expect(timeline.runs?.[0].run).toMatchObject({ id: "run_task_1", status: "succeeded" });
  });

  it("recovers expired task run leases when reading the task timeline", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_stale",
        name: "Stale Company",
        openclawLeader: {
          id: "leader_stale",
          label: "Lead",
          openclawAgentId: "main",
        },
      }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_stale/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "task_stale", title: "Collect information" }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/tasks/task_stale/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "leader_stale" }),
    });
    const queuedResponse = await fetch(`http://127.0.0.1:${port}/api/oui/tasks/task_stale/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "run_stale", dispatch: false }),
    });
    expect(queuedResponse.status).toBe(202);

    const oldNow = new Date("2026-01-01T00:00:00.000Z");
    const claimed = await store.claimRun("run_stale", {
      workerId: "stale-worker",
      leaseMs: 1,
      now: oldNow,
    });
    expect(claimed?.run.status).toBe("starting");

    const timelineResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/tasks/task_stale/timeline`,
    );
    const timeline = (await timelineResponse.json()) as {
      task?: { status?: string };
      runs?: Array<{ run?: { id?: string; status?: string; error?: string | null } }>;
    };

    expect(timelineResponse.status).toBe(200);
    expect(timeline.task).toMatchObject({ status: "blocked" });
    expect(timeline.runs?.[0].run).toMatchObject({
      id: "run_stale",
      status: "failed",
      error: "Run lease expired.",
    });
  });

  it("lists and creates independent OpenClaw-led companies", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_product",
        name: "OUI Product Company",
        openclawLeader: {
          id: "ceo_product",
          label: "Product CEO",
          openclawAgentId: "main",
        },
      }),
    });
    const createBody = (await createResponse.json()) as {
      company?: { id?: string; ceoAgentId?: string };
      ceo?: { id?: string; adapterKind?: string };
    };
    expect(createResponse.status).toBe(201);
    expect(createBody).toMatchObject({
      company: { id: "company_product", ceoAgentId: "ceo_product" },
      ceo: { id: "ceo_product", adapterKind: "openclaw" },
    });
    await productStore.createTask({
      id: "task_product_done",
      companyId: "company_product",
      title: "Finished work",
    });
    const metricRunResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/tasks/task_product_done/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: "run_product_done", dispatch: false }),
      },
    );
    expect(metricRunResponse.status).toBe(202);
    await productStore.updateTaskStatus("task_product_done", "done");
    await productStore.recordCostEvent({
      runId: "run_product_done",
      source: "test",
      usage: { inputTokens: 12, outputTokens: 8 },
    });

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies`);
    const listBody = (await listResponse.json()) as {
      companies?: Array<{ id?: string }>;
      summaries?: Array<{
        company?: { id?: string };
        ceo?: { id?: string; adapterKind?: string };
        taskCount?: number;
        completedTaskCount?: number;
        openInboxCount?: number;
        tokenUsageTotal?: number;
      }>;
    };
    expect(listResponse.status).toBe(200);
    expect(listBody.companies?.map((company) => company.id)).toEqual(["company_product"]);
    expect(listBody.summaries?.[0]).toMatchObject({
      company: { id: "company_product" },
      ceo: { id: "ceo_product", adapterKind: "openclaw" },
      taskCount: 1,
      completedTaskCount: 1,
      openInboxCount: 0,
      tokenUsageTotal: 20,
    });
  });

  it("deletes a company and its linked OUI run records without touching other companies", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_delete",
        name: "Delete Company",
        openclawLeader: {
          id: "ceo_delete",
          label: "Delete CEO",
          openclawAgentId: "main",
        },
      }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_keep",
        name: "Keep Company",
        openclawLeader: {
          id: "ceo_keep",
          label: "Keep CEO",
          openclawAgentId: "main",
        },
      }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_delete/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "task_delete", title: "Work to remove" }),
    });
    const runResponse = await fetch(`http://127.0.0.1:${port}/api/oui/tasks/task_delete/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "run_delete", dispatch: false }),
    });
    expect(runResponse.status).toBe(202);

    const deleteResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_delete`,
      { method: "DELETE" },
    );
    const deleteBody = (await deleteResponse.json()) as {
      company?: { id?: string };
      deletedRunIds?: string[];
      summaries?: Array<{ company?: { id?: string } }>;
    };
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody.company).toMatchObject({ id: "company_delete" });
    expect(deleteBody.deletedRunIds).toEqual(["run_delete"]);
    expect(deleteBody.summaries?.map((summary) => summary.company?.id)).toEqual(["company_keep"]);

    const deletedCompanyResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_delete`,
    );
    expect(deletedCompanyResponse.status).toBe(404);

    const deletedRunResponse = await fetch(`http://127.0.0.1:${port}/api/oui/runs/run_delete`);
    expect(deletedRunResponse.status).toBe(404);

    const keptCompanyResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_keep`,
    );
    const keptCompanyBody = (await keptCompanyResponse.json()) as { company?: { id?: string } };
    expect(keptCompanyResponse.status).toBe(200);
    expect(keptCompanyBody.company).toMatchObject({ id: "company_keep" });
  });

  it("serves company runbooks, inbox, and control-room read model without starting work", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    const companyResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_control",
        name: "Control Company",
        openclawLeader: {
          id: "ceo_control",
          label: "Control CEO",
          openclawAgentId: "main",
        },
      }),
    });
    expect(companyResponse.status).toBe(201);

    const draftResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_control/runbooks`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "runbook_control",
          versionId: "runbook_control_v1",
          title: "Build control room",
          sourceType: "ceo_chat",
          objective: "Show real company state.",
          operatingMode: "project",
          stages: [{ id: "monitor", title: "Monitor" }],
        }),
      },
    );
    expect(draftResponse.status).toBe(201);

    const approveResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/runbook-versions/runbook_control_v1/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedBy: "owner" }),
      },
    );
    const approveBody = (await approveResponse.json()) as {
      version?: { status?: string };
      controlRoom?: { nextStep?: string; nodes?: Array<{ title?: string; status?: string }> };
    };
    expect(approveResponse.status).toBe(200);
    expect(approveBody.version).toMatchObject({ status: "approved" });
    expect(approveBody.controlRoom?.nodes?.[0]).toMatchObject({
      title: "Monitor",
      status: "current",
    });

    const startResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/runbook-versions/runbook_control_v1/start`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startedBy: "owner" }),
      },
    );
    const startBody = (await startResponse.json()) as {
      version?: { status?: string };
      company?: { status?: string; currentStage?: string };
      workNodes?: Array<{ title?: string; status?: string; orderIndex?: number }>;
      execution?: { stopReason?: string; completedNodes?: unknown[]; runs?: unknown[] };
      controlRoom?: { nodes?: Array<{ title?: string; status?: string; sourceStatus?: string }> };
    };
    expect(startResponse.status).toBe(200);
    expect(startBody.version).toMatchObject({ status: "completed" });
    expect(startBody.company).toMatchObject({ status: "idle", currentStage: "Completed" });
    expect(startBody.execution).toMatchObject({ stopReason: "completed" });
    expect(startBody.execution?.completedNodes).toHaveLength(1);
    expect(startBody.execution?.runs).toHaveLength(1);
    expect(startBody.workNodes?.[0]).toMatchObject({
      title: "Monitor",
      status: "done",
      orderIndex: 1,
    });
    expect(startBody.controlRoom?.nodes?.[0]).toMatchObject({
      title: "Monitor",
      status: "done",
      sourceStatus: "done",
    });

    const inboxResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_control/inbox`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "inbox_control",
          itemType: "approval",
          title: "Approve monitor result",
          runbookVersionId: "runbook_control_v1",
        }),
      },
    );
    expect(inboxResponse.status).toBe(201);

    const detailResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_control`,
    );
    const detailBody = (await detailResponse.json()) as {
      runbooks?: Array<{ id?: string; activeVersionId?: string }>;
      runbookVersions?: Array<{ id?: string; status?: string }>;
      activeRunbookVersion?: { id?: string; objective?: string };
      workNodes?: Array<{ runbookVersionId?: string; status?: string }>;
      inboxItems?: Array<{ id?: string; status?: string }>;
      controlRoom?: { openInboxItems?: Array<{ id?: string }>; activeRunbook?: { id?: string } };
    };
    expect(detailResponse.status).toBe(200);
    expect(detailBody.runbooks?.[0]).toMatchObject({
      id: "runbook_control",
      activeVersionId: "runbook_control_v1",
    });
    expect(detailBody.activeRunbookVersion).toMatchObject({
      id: "runbook_control_v1",
      objective: "Show real company state.",
    });
    expect(detailBody.runbookVersions?.[0]).toMatchObject({
      id: "runbook_control_v1",
      status: "completed",
    });
    expect(detailBody.workNodes?.[0]).toMatchObject({
      runbookVersionId: "runbook_control_v1",
      status: "done",
    });
    expect(detailBody.inboxItems?.[0]).toMatchObject({ id: "inbox_control", status: "open" });
    expect(detailBody.controlRoom?.openInboxItems?.map((item) => item.id)).toEqual([
      "inbox_control",
    ]);

    const runbooksResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_control/runbooks`,
    );
    const runbooksBody = (await runbooksResponse.json()) as {
      activeVersion?: { id?: string };
      versions?: Array<{ id?: string }>;
      workNodes?: Array<{ runbookVersionId?: string }>;
    };
    expect(runbooksResponse.status).toBe(200);
    expect(runbooksBody.activeVersion?.id).toBe("runbook_control_v1");
    expect(runbooksBody.versions?.[0]?.id).toBe("runbook_control_v1");
    expect(runbooksBody.workNodes?.[0]?.runbookVersionId).toBe("runbook_control_v1");

    const resolveResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/inbox/inbox_control/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reply", responseText: "Continue", actorId: "owner" }),
      },
    );
    expect(resolveResponse.status).toBe(200);

    const openInboxResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_control/inbox?status=open`,
    );
    const openInboxBody = (await openInboxResponse.json()) as { items?: unknown[] };
    expect(openInboxResponse.status).toBe(200);
    expect(openInboxBody.items).toEqual([]);
  });

  it("advances runbook nodes, pauses for owner decisions, and resumes from inbox", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_nodes",
        name: "Node Company",
        openclawLeader: {
          id: "ceo_nodes",
          label: "Node CEO",
          openclawAgentId: "main",
        },
      }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_nodes/runbooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "runbook_nodes",
        versionId: "runbook_nodes_v1",
        title: "Build monitored company",
        sourceType: "ceo_chat",
        objective: "Move work through stages.",
        stages: [
          { id: "plan", title: "Plan", type: "work" },
          { id: "owner_choice", title: "Choose direction", type: "user_decision" },
          { id: "ship", title: "Ship", type: "work" },
          { id: "report", title: "CEO report", type: "report" },
        ],
      }),
    });
    const startResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/runbook-versions/runbook_nodes_v1/start`,
      { method: "POST", headers: { "content-type": "application/json" } },
    );
    const startBody = (await startResponse.json()) as {
      company?: { status?: string; currentStage?: string };
      execution?: { stopReason?: string; completedNodes?: unknown[] };
      workNodes?: Array<{
        id?: string;
        title?: string;
        status?: string;
        inboxItemId?: string | null;
      }>;
      detail?: {
        inboxItems?: Array<{ id?: string; itemType?: string; status?: string }>;
        artifacts?: Array<{ kind?: string; title?: string }>;
      };
    };
    expect(startResponse.status).toBe(200);
    expect(startBody.company).toMatchObject({
      status: "waiting_user",
      currentStage: "Choose direction",
    });
    expect(startBody.execution).toMatchObject({ stopReason: "waiting_user" });
    expect(startBody.execution?.completedNodes).toHaveLength(1);
    expect(startBody.workNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Plan", status: "done" }),
        expect.objectContaining({ title: "Choose direction", status: "waiting_user" }),
        expect.objectContaining({ title: "Ship", status: "pending" }),
        expect.objectContaining({ title: "CEO report", status: "pending" }),
      ]),
    );
    expect(startBody.detail?.inboxItems?.[0]).toMatchObject({
      itemType: "choice",
      status: "open",
    });
    expect(startBody.detail?.artifacts?.[0]).toMatchObject({
      kind: "stage_output",
      title: "Plan output",
    });

    const firstInboxId = startBody.detail?.inboxItems?.[0]?.id ?? "";
    const firstResolveResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/inbox/${encodeURIComponent(firstInboxId)}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          responseText: "Continue with shipping.",
          actorId: "owner",
        }),
      },
    );
    const firstResolveBody = (await firstResolveResponse.json()) as {
      item?: { status?: string };
      completedNode?: { node?: { status?: string } };
      advance?: { stopReason?: string; completedNodes?: unknown[]; createdInboxItems?: unknown[] };
      detail?: {
        company?: { status?: string; currentStage?: string };
        workNodes?: Array<{ title?: string; status?: string }>;
        inboxItems?: Array<{ id?: string; itemType?: string; status?: string }>;
        artifacts?: Array<{ kind?: string; title?: string }>;
      };
    };
    expect(firstResolveResponse.status).toBe(200);
    expect(firstResolveBody.item).toMatchObject({ status: "resolved" });
    expect(firstResolveBody.completedNode?.node).toMatchObject({ status: "done" });
    expect(firstResolveBody.advance).toMatchObject({ stopReason: "waiting_user" });
    expect(firstResolveBody.advance?.completedNodes).toHaveLength(1);
    expect(firstResolveBody.advance?.createdInboxItems).toHaveLength(1);
    expect(firstResolveBody.detail?.company).toMatchObject({
      status: "waiting_user",
      currentStage: "CEO report",
    });
    expect(firstResolveBody.detail?.workNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Plan", status: "done" }),
        expect.objectContaining({ title: "Choose direction", status: "done" }),
        expect.objectContaining({ title: "Ship", status: "done" }),
        expect.objectContaining({ title: "CEO report", status: "waiting_user" }),
      ]),
    );
    expect(
      firstResolveBody.detail?.inboxItems?.find((item) => item.status === "open"),
    ).toMatchObject({ itemType: "report_ack" });

    const reportInboxId =
      firstResolveBody.detail?.inboxItems?.find((item) => item.status === "open")?.id ?? "";
    const reportResolveResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/inbox/${encodeURIComponent(reportInboxId)}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", actorId: "owner" }),
      },
    );
    const reportResolveBody = (await reportResolveResponse.json()) as {
      detail?: {
        company?: { status?: string; currentStage?: string };
        activeRunbookVersion?: { status?: string };
        workNodes?: Array<{ status?: string }>;
        inboxItems?: Array<{ status?: string }>;
        artifacts?: Array<{ kind?: string; title?: string }>;
      };
    };
    expect(reportResolveResponse.status).toBe(200);
    expect(reportResolveBody.detail?.company).toMatchObject({
      status: "idle",
      currentStage: "Completed",
    });
    expect(reportResolveBody.detail?.activeRunbookVersion).toMatchObject({ status: "completed" });
    expect(reportResolveBody.detail?.workNodes?.every((node) => node.status === "done")).toBe(true);
    expect(reportResolveBody.detail?.inboxItems?.every((item) => item.status !== "open")).toBe(
      true,
    );
    expect(reportResolveBody.detail?.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "stage_output", title: "Plan output" }),
        expect.objectContaining({ kind: "stage_output", title: "Choose direction output" }),
        expect.objectContaining({ kind: "stage_output", title: "Ship output" }),
        expect.objectContaining({ kind: "stage_output", title: "CEO report output" }),
        expect.objectContaining({ kind: "report", title: "CEO report report" }),
      ]),
    );
  });

  it("runs executable runbook nodes through the dispatcher on start", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_dispatch",
        name: "Dispatch Company",
        openclawLeader: {
          id: "ceo_dispatch",
          label: "Dispatch CEO",
          openclawAgentId: "main",
        },
      }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_dispatch/runbooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "runbook_dispatch",
        versionId: "runbook_dispatch_v1",
        title: "Dispatch work",
        sourceType: "ceo_chat",
        objective: "Prove real work-node execution.",
        stages: [{ id: "dispatch", title: "Dispatch" }],
      }),
    });
    const startResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/runbook-versions/runbook_dispatch_v1/start`,
      { method: "POST", headers: { "content-type": "application/json" } },
    );
    const startBody = (await startResponse.json()) as {
      execution?: { runs?: Array<{ status?: string }>; completedNodes?: unknown[] };
      workNodes?: Array<{ id?: string; status?: string; runId?: string | null }>;
      detail?: { artifacts?: Array<{ kind?: string; summary?: string }> };
    };
    expect(startResponse.status).toBe(200);
    expect(startBody.execution?.runs?.[0]).toMatchObject({ status: "succeeded" });
    expect(startBody.execution?.completedNodes).toHaveLength(1);
    expect(startBody.workNodes?.[0]).toMatchObject({ status: "done" });
    expect(startBody.detail?.artifacts?.[0]).toMatchObject({
      kind: "stage_output",
      summary: "Adapter finished.",
    });
  });

  it("uses OpenClaw message text instead of generic completion summaries", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([
        createAdapter("openclaw-local", "openclaw", undefined, async () => ({
          status: "succeeded",
          summary: "OpenClaw run completed.",
          resultJson: {
            message: {
              content: [{ type: "text", text: "Concrete CEO report for the owner." }],
            },
          },
        })),
      ]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_openclaw_summary",
        name: "Summary Company",
        openclawLeader: {
          id: "ceo_openclaw_summary",
          label: "Summary CEO",
          openclawAgentId: "main",
        },
      }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_openclaw_summary/runbooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "runbook_openclaw_summary",
        versionId: "runbook_openclaw_summary_v1",
        title: "OpenClaw summary",
        sourceType: "ceo_chat",
        objective: "Show concrete summaries.",
        stages: [{ id: "report", title: "Report" }],
      }),
    });

    const startResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/runbook-versions/runbook_openclaw_summary_v1/start`,
      { method: "POST", headers: { "content-type": "application/json" } },
    );
    const startBody = (await startResponse.json()) as {
      detail?: {
        artifacts?: Array<{ summary?: string }>;
        workNodes?: Array<{ summary?: string }>;
      };
    };
    expect(startResponse.status).toBe(200);
    expect(startBody.detail?.artifacts?.[0]).toMatchObject({
      summary: "Concrete CEO report for the owner.",
    });
    expect(startBody.detail?.workNodes?.[0]).toMatchObject({
      summary: "Concrete CEO report for the owner.",
    });
  });

  it("retries exception inbox items instead of treating them as completed work", async () => {
    const { store, productStore } = createStores();
    let attempts = 0;
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([
        createAdapter("openclaw-local", "openclaw", undefined, async () => {
          attempts += 1;
          if (attempts === 1) {
            return {
              status: "blocked",
              summary: "Temporary adapter block.",
              error: "Temporary adapter block.",
            };
          }
          return {
            status: "succeeded",
            summary: "Retry succeeded.",
            resultJson: { text: "Recovered output." },
          };
        }),
      ]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_retry_exception",
        name: "Retry Exception Company",
        openclawLeader: {
          id: "ceo_retry_exception",
          label: "Retry CEO",
          openclawAgentId: "main",
        },
      }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_retry_exception/runbooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "runbook_retry_exception",
        versionId: "runbook_retry_exception_v1",
        title: "Retry exception",
        sourceType: "ceo_chat",
        objective: "Retry blocked work.",
        stages: [{ id: "dispatch", title: "Dispatch" }],
      }),
    });

    const startResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/runbook-versions/runbook_retry_exception_v1/start`,
      { method: "POST", headers: { "content-type": "application/json" } },
    );
    const startBody = (await startResponse.json()) as {
      company?: { status?: string };
      execution?: { stopReason?: string };
      detail?: {
        workNodes?: Array<{ status?: string; runId?: string | null }>;
        inboxItems?: Array<{ id?: string; itemType?: string; status?: string }>;
      };
    };
    expect(startResponse.status).toBe(200);
    expect(startBody.company).toMatchObject({ status: "blocked" });
    expect(startBody.execution).toMatchObject({ stopReason: "blocked" });
    expect(startBody.detail?.workNodes?.[0]).toMatchObject({ status: "blocked" });
    expect(startBody.detail?.inboxItems?.[0]).toMatchObject({
      itemType: "exception",
      status: "open",
    });
    const firstRunId = startBody.detail?.workNodes?.[0]?.runId;

    const inboxId = startBody.detail?.inboxItems?.[0]?.id ?? "";
    const resolveResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/inbox/${encodeURIComponent(inboxId)}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", actorId: "owner" }),
      },
    );
    const resolveBody = (await resolveResponse.json()) as {
      completedNode?: unknown;
      detail?: {
        company?: { status?: string; currentStage?: string };
        workNodes?: Array<{ status?: string; runId?: string | null; summary?: string | null }>;
        inboxItems?: Array<{ status?: string }>;
        artifacts?: Array<{ summary?: string | null }>;
      };
    };
    expect(resolveResponse.status).toBe(200);
    expect(resolveBody.completedNode).toBeNull();
    expect(attempts).toBe(2);
    expect(resolveBody.detail?.company).toMatchObject({
      status: "idle",
      currentStage: "Completed",
    });
    expect(resolveBody.detail?.workNodes?.[0]).toMatchObject({
      status: "done",
      summary: "Retry succeeded.",
    });
    expect(resolveBody.detail?.workNodes?.[0]?.runId).not.toBe(firstRunId);
    expect(resolveBody.detail?.inboxItems?.every((item) => item.status !== "open")).toBe(true);
    expect(resolveBody.detail?.artifacts?.[0]).toMatchObject({ summary: "Retry succeeded." });
  });

  it("returns control while work-node adapter execution finishes in the background", async () => {
    const { store, productStore } = createStores();
    const registry = createOuiAdapterRegistry([
      createAdapter("openclaw-local", "openclaw", undefined, async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          status: "succeeded",
          summary: "Delayed adapter finished.",
          resultJson: { text: "Delayed output." },
        };
      }),
    ]);
    const dispatcher = new OuiRunDispatcher({
      store,
      registry,
      flags: createDefaultOuiFeatureFlags(),
      workerId: "test-inline-worker",
      leaseMs: 5_000,
      inlineWaitMs: 1,
    });
    const server = createOuiHttpServer({
      store,
      productStore,
      registry,
      dispatcher,
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_deferred",
        name: "Deferred Company",
        openclawLeader: {
          id: "ceo_deferred",
          label: "Deferred CEO",
          openclawAgentId: "main",
        },
      }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_deferred/runbooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "runbook_deferred",
        versionId: "runbook_deferred_v1",
        title: "Deferred dispatch",
        sourceType: "ceo_chat",
        objective: "Do not block the UI request.",
        stages: [{ id: "dispatch", title: "Dispatch slowly" }],
      }),
    });

    const startResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/runbook-versions/runbook_deferred_v1/start`,
      { method: "POST", headers: { "content-type": "application/json" } },
    );
    const startBody = (await startResponse.json()) as {
      execution?: {
        stopReason?: string;
        dispatches?: Array<{ status?: string }>;
        runs?: Array<{ status?: string }>;
      };
      workNodes?: Array<{ status?: string; runId?: string | null }>;
    };
    expect(startResponse.status).toBe(200);
    expect(startBody.execution).toMatchObject({
      stopReason: "running",
      dispatches: [expect.objectContaining({ status: "deferred" })],
    });
    expect(startBody.execution?.runs?.[0]).toMatchObject({ status: "running" });
    expect(startBody.workNodes?.[0]).toMatchObject({ status: "running" });

    await new Promise((resolve) => setTimeout(resolve, 140));

    const detailResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_deferred`,
    );
    const detailBody = (await detailResponse.json()) as {
      company?: { status?: string; currentStage?: string };
      activeRunbookVersion?: { status?: string };
      workNodes?: Array<{ status?: string }>;
      artifacts?: Array<{ summary?: string }>;
    };
    expect(detailResponse.status).toBe(200);
    expect(detailBody.company).toMatchObject({ status: "idle", currentStage: "Completed" });
    expect(detailBody.activeRunbookVersion).toMatchObject({ status: "completed" });
    expect(detailBody.workNodes?.[0]).toMatchObject({ status: "done" });
    expect(detailBody.artifacts?.[0]).toMatchObject({ summary: "Delayed adapter finished." });
  });

  it("continues deferred runbooks to the next node when details are refreshed", async () => {
    const { store, productStore } = createStores();
    const registry = createOuiAdapterRegistry([
      createAdapter("openclaw-local", "openclaw", undefined, async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        const stage =
          ctx.run.input.stage &&
          typeof ctx.run.input.stage === "object" &&
          !Array.isArray(ctx.run.input.stage)
            ? (ctx.run.input.stage as Record<string, unknown>)
            : {};
        const title = typeof stage.title === "string" ? stage.title : "Node";
        return {
          status: "succeeded",
          summary: `${title} finished.`,
          resultJson: { stageTitle: title },
        };
      }),
    ]);
    const dispatcher = new OuiRunDispatcher({
      store,
      registry,
      flags: createDefaultOuiFeatureFlags(),
      workerId: "test-continuation-worker",
      leaseMs: 5_000,
      inlineWaitMs: 1,
    });
    const server = createOuiHttpServer({
      store,
      productStore,
      registry,
      dispatcher,
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_deferred_chain",
        name: "Deferred Chain Company",
        openclawLeader: {
          id: "ceo_deferred_chain",
          label: "Deferred Chain CEO",
          openclawAgentId: "main",
        },
      }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_deferred_chain/runbooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "runbook_deferred_chain",
        versionId: "runbook_deferred_chain_v1",
        title: "Deferred chain",
        sourceType: "ceo_chat",
        objective: "Continue after a slow node finishes.",
        stages: [
          { id: "first", title: "First slow node" },
          { id: "second", title: "Second slow node" },
        ],
      }),
    });

    const startResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/runbook-versions/runbook_deferred_chain_v1/start`,
      { method: "POST", headers: { "content-type": "application/json" } },
    );
    const startBody = (await startResponse.json()) as {
      execution?: { stopReason?: string; dispatches?: Array<{ status?: string }> };
      workNodes?: Array<{ title?: string; status?: string }>;
    };
    expect(startResponse.status).toBe(200);
    expect(startBody.execution).toMatchObject({
      stopReason: "running",
      dispatches: [expect.objectContaining({ status: "deferred" })],
    });
    expect(startBody.workNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "First slow node", status: "running" }),
        expect.objectContaining({ title: "Second slow node", status: "pending" }),
      ]),
    );

    await new Promise((resolve) => setTimeout(resolve, 80));

    const firstDetailResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_deferred_chain`,
    );
    const firstDetailBody = (await firstDetailResponse.json()) as {
      company?: { status?: string; currentStage?: string };
      workNodes?: Array<{ title?: string; status?: string }>;
    };
    expect(firstDetailResponse.status).toBe(200);
    expect(firstDetailBody.company).toMatchObject({
      status: "running",
      currentStage: "Second slow node",
    });
    expect(firstDetailBody.workNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "First slow node", status: "done" }),
        expect.objectContaining({ title: "Second slow node", status: "running" }),
      ]),
    );

    await new Promise((resolve) => setTimeout(resolve, 80));

    const finalDetailResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_deferred_chain`,
    );
    const finalDetailBody = (await finalDetailResponse.json()) as {
      company?: { status?: string; currentStage?: string };
      activeRunbookVersion?: { status?: string };
      workNodes?: Array<{ title?: string; status?: string }>;
      artifacts?: Array<{ summary?: string }>;
    };
    expect(finalDetailResponse.status).toBe(200);
    expect(finalDetailBody.company).toMatchObject({ status: "idle", currentStage: "Completed" });
    expect(finalDetailBody.activeRunbookVersion).toMatchObject({ status: "completed" });
    expect(finalDetailBody.workNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "First slow node", status: "done" }),
        expect.objectContaining({ title: "Second slow node", status: "done" }),
      ]),
    );
    expect(finalDetailBody.artifacts?.map((artifact) => artifact.summary)).toEqual(
      expect.arrayContaining(["First slow node finished.", "Second slow node finished."]),
    );
  });

  it("creates routines from runbooks and triggers them through the work wakeup queue", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_routine",
        name: "Routine Company",
        openclawLeader: {
          id: "ceo_routine",
          label: "Routine CEO",
          openclawAgentId: "routine-ceo",
          adapterId: "openclaw-local",
        },
      }),
    });
    await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_routine/runbooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "runbook_routine",
        versionId: "runbook_routine_v1",
        title: "Daily topic scan",
        objective: "Collect daily topics.",
        operatingMode: "routine",
        stages: [{ id: "scan", title: "Scan topics", type: "work" }],
      }),
    });

    const createRoutineResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_routine/routines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "routine_daily_topics",
          runbookVersionId: "runbook_routine_v1",
          title: "Daily topic scan",
          triggerKind: "schedule",
          schedule: { intervalMinutes: 1440 },
        }),
      },
    );
    const createRoutineBody = (await createRoutineResponse.json()) as {
      routine?: { id?: string; status?: string; nextTriggerAt?: string | null };
      detail?: { routines?: Array<{ id?: string }> };
    };
    expect(createRoutineResponse.status).toBe(201);
    expect(createRoutineBody.routine).toMatchObject({
      id: "routine_daily_topics",
      status: "active",
    });
    expect(createRoutineBody.routine?.nextTriggerAt).toBeTruthy();
    expect(createRoutineBody.detail?.routines?.map((routine) => routine.id)).toEqual([
      "routine_daily_topics",
    ]);

    const triggerResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/routines/routine_daily_topics/trigger`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actorId: "user" }),
      },
    );
    const triggerBody = (await triggerResponse.json()) as {
      routine?: { lastTriggeredAt?: string | null };
      trigger?: { status?: string };
      detail?: {
        company?: { status?: string; currentStage?: string };
        activeRunbookVersion?: { status?: string };
        workNodes?: Array<{ status?: string }>;
      };
    };
    expect(triggerResponse.status).toBe(200);
    expect(triggerBody.trigger).toMatchObject({ status: "queued" });
    expect(triggerBody.routine?.lastTriggeredAt).toBeTruthy();
    expect(triggerBody.detail?.company).toMatchObject({
      status: "idle",
      currentStage: "Completed",
    });
    expect(triggerBody.detail?.activeRunbookVersion).toMatchObject({ status: "completed" });
    expect(triggerBody.detail?.workNodes?.map((node) => node.status)).toEqual(["done"]);
  });

  it("keeps meeting room state global and generates markdown minutes artifacts", async () => {
    const { store, productStore } = createStores();
    const artifactRoot = createArtifactRoot("oui-http-meetings");
    const server = createOuiHttpServer({
      store,
      productStore,
      artifactRoot,
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/oui/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "meeting_strategy",
        title: "Strategy meeting",
        objective: "Discuss company direction.",
        participants: [
          {
            id: "main",
            label: "Main",
            adapterKind: "openclaw",
            adapterId: "openclaw-local",
            openclawAgentId: "main",
          },
          {
            id: "reviewer",
            label: "Reviewer",
            adapterKind: "openclaw",
            adapterId: "openclaw-local",
            openclawAgentId: "reviewer",
          },
        ],
      }),
    });
    expect(createResponse.status).toBe(201);

    const updateParticipantsResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/meetings/meeting_strategy/participants`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participants: [
            {
              id: "reviewer",
              label: "Reviewer",
              adapterKind: "openclaw",
              adapterId: "openclaw-local",
              openclawAgentId: "reviewer",
              speakingOrder: 1,
              muted: false,
              thinkingIntensity: "medium",
            },
            {
              id: "main",
              label: "Main",
              adapterKind: "openclaw",
              adapterId: "openclaw-local",
              openclawAgentId: "main",
              speakingOrder: 2,
              muted: true,
              thinkingIntensity: "high",
            },
          ],
        }),
      },
    );
    expect(updateParticipantsResponse.status).toBe(200);

    const turnResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/meetings/meeting_strategy/turn`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "What should the CEO focus on?" }),
      },
    );
    const turnBody = (await turnResponse.json()) as {
      participantMessages?: Array<{
        participantId?: string | null;
        metadata?: { execution?: string; runStatus?: string };
      }>;
    };
    expect(turnResponse.status).toBe(201);
    expect(turnBody.participantMessages).toHaveLength(1);
    expect(turnBody.participantMessages?.[0]?.participantId).toBe("reviewer");
    expect(turnBody.participantMessages?.[0]?.metadata).toMatchObject({
      execution: "openclaw_runtime",
      runStatus: "succeeded",
    });

    const minutesResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/meetings/meeting_strategy/minutes`,
      { method: "POST" },
    );
    const minutesBody = (await minutesResponse.json()) as {
      meeting?: { status?: string; minutesArtifactId?: string };
      artifact?: { id?: string; kind?: string; path?: string | null; meetingId?: string | null };
    };
    expect(minutesResponse.status).toBe(201);
    expect(minutesBody.meeting).toMatchObject({
      status: "ended",
      minutesArtifactId: "meeting_strategy:minutes",
    });
    expect(minutesBody.artifact).toMatchObject({
      id: "meeting_strategy:minutes",
      kind: "meeting_minutes",
      meetingId: "meeting_strategy",
    });
    const minutesPath = minutesBody.artifact?.path;
    expect(minutesPath?.startsWith(artifactRoot)).toBe(true);
    const markdown = await readFile(minutesPath ?? "", "utf8");
    expect(markdown).toContain("# Strategy meeting");
    expect(markdown).toContain("thinking:medium");
    expect(markdown).toContain("What should the CEO focus on?");

    const detailResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/meetings/meeting_strategy`,
    );
    const detailBody = (await detailResponse.json()) as {
      meeting?: { id?: string };
      artifacts?: Array<{ id?: string }>;
      messages?: Array<{ role?: string }>;
    };
    expect(detailResponse.status).toBe(200);
    expect(detailBody.meeting?.id).toBe("meeting_strategy");
    expect(detailBody.artifacts?.map((artifact) => artifact.id)).toEqual([
      "meeting_strategy:minutes",
    ]);
    expect(detailBody.messages?.map((message) => message.role)).toEqual(["owner", "participant"]);
  });

  it("supports moderator document revisions and round-based discussion", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([
        createAdapter("openclaw-local", "openclaw", undefined, async (ctx) => {
          const message =
            typeof ctx.run.input.message === "string"
              ? ctx.run.input.message
              : String(ctx.run.input);
          const text = message.includes("You are the moderator")
            ? "Moderator doc updated.\n- Keep disagreement visible.\n- Focus the next round on tradeoffs."
            : "Participant revision.\n- Claim\n- Correction\n- Uncertainty";
          return {
            status: "succeeded",
            summary: text,
            resultJson: { text },
          };
        }),
      ]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/oui/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "meeting_rounds",
        title: "Future of work",
        objective: "Discuss how humans adapt after AGI.",
        participants: [
          {
            id: "alpha",
            label: "Alpha",
            adapterKind: "openclaw",
            adapterId: "openclaw-local",
            openclawAgentId: "alpha",
          },
          {
            id: "beta",
            label: "Beta",
            adapterKind: "openclaw",
            adapterId: "openclaw-local",
            openclawAgentId: "beta",
          },
        ],
      }),
    });
    const createBody = (await createResponse.json()) as {
      meeting?: {
        discussion?: { currentRound?: number; phase?: string; activeDocument?: { text?: string } };
      };
    };
    expect(createResponse.status).toBe(201);
    expect(createBody.meeting?.discussion).toMatchObject({
      currentRound: 0,
      phase: "drafting",
    });
    expect(createBody.meeting?.discussion?.activeDocument?.text).toContain(
      "Meeting topic: Future of work",
    );

    const reviseResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/meetings/meeting_rounds/moderator/revise`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction: "Lean toward practical advice and keep disagreement explicit.",
        }),
      },
    );
    const reviseBody = (await reviseResponse.json()) as {
      meeting?: { discussion?: { activeDocument?: { text?: string; updatedBy?: string } } };
      messages?: Array<{ role?: string }>;
    };
    expect(reviseResponse.status).toBe(200);
    expect(reviseBody.meeting?.discussion?.activeDocument).toMatchObject({
      text: expect.stringContaining("Moderator doc updated."),
      updatedBy: "moderator",
    });
    expect(reviseBody.messages?.map((message) => message.role)).toEqual(["owner", "system"]);

    const nextRoundResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/meetings/meeting_rounds/rounds/next`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
      },
    );
    const nextRoundBody = (await nextRoundResponse.json()) as {
      meeting?: {
        discussion?: {
          currentRound?: number;
          phase?: string;
          roundHistory?: Array<{
            round?: number;
            participantMessageIds?: string[];
            moderatorMessageId?: string | null;
          }>;
        };
      };
      participantMessages?: Array<{ role?: string; metadata?: { round?: number } }>;
      moderatorMessage?: { role?: string; metadata?: { round?: number } };
    };
    expect(nextRoundResponse.status).toBe(201);
    expect(nextRoundBody.meeting?.discussion).toMatchObject({
      currentRound: 1,
      phase: "awaiting_user",
    });
    expect(nextRoundBody.participantMessages).toHaveLength(2);
    expect(
      nextRoundBody.participantMessages?.every((message) => message.metadata?.round === 1),
    ).toBe(true);
    expect(nextRoundBody.moderatorMessage).toMatchObject({
      role: "system",
      metadata: { round: 1 },
    });
    expect(nextRoundBody.meeting?.discussion?.roundHistory?.[0]).toMatchObject({
      round: 1,
      participantMessageIds: expect.any(Array),
      moderatorMessageId: expect.any(String),
    });
  });

  it("stores CEO chat messages and generates a runbook draft from company context", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    const companyResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "company_ceo",
        name: "CEO Company",
        openclawLeader: {
          id: "ceo_agent",
          label: "CEO Agent",
          openclawAgentId: "main",
        },
      }),
    });
    expect(companyResponse.status).toBe(201);

    const messageResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_ceo/ceo/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "把 OUI 做成 agent 公司系统。" }),
      },
    );
    const messageBody = (await messageResponse.json()) as {
      conversation?: { id?: string };
      messages?: Array<{ role?: string; content?: string }>;
      detail?: { ceoMessages?: Array<{ role?: string }> };
    };
    expect(messageResponse.status).toBe(201);
    expect(messageBody.conversation?.id).toBeTruthy();
    expect(messageBody.messages?.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messageBody.detail?.ceoMessages?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);

    const draftResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_ceo/ceo/generate-runbook`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: messageBody.conversation?.id }),
      },
    );
    const draftBody = (await draftResponse.json()) as {
      runbookDraft?: {
        version?: {
          sourceType?: string;
          objective?: string;
          stages?: Array<{ id?: string; title?: string }>;
        };
      };
      detail?: {
        runbooks?: Array<{ status?: string }>;
        ceoMessages?: Array<{ role?: string; content?: string }>;
      };
    };
    expect(draftResponse.status).toBe(201);
    expect(draftBody.runbookDraft?.version).toMatchObject({
      sourceType: "ceo_chat",
      objective: "把 OUI 做成 agent 公司系统。",
    });
    expect(draftBody.runbookDraft?.version?.stages?.[0]).toMatchObject({
      id: "understand",
      title: "目标确认",
    });
    expect(draftBody.detail?.runbooks?.[0]).toMatchObject({ status: "draft" });
    expect(draftBody.detail?.ceoMessages?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
  });

  it("shows external employee adapters as preview-only by default", async () => {
    const { store, productStore } = createStores();
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([
        createAdapter("openclaw-local", "openclaw"),
        createAdapter("codex-local", "codex"),
      ]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    const response = await fetch(`http://127.0.0.1:${port}/api/oui/adapters/previews`);
    const body = (await response.json()) as {
      adapters?: Array<{ adapterId?: string; executable?: boolean; reason?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.adapters?.find((adapter) => adapter.adapterId === "codex-local")).toMatchObject({
      executable: false,
      reason: "External adapter execution is disabled.",
    });
  });
});

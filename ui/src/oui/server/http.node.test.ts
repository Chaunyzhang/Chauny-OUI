// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createOuiAdapterRegistry } from "../adapters/registry.ts";
import { runOuiMigrations } from "../db/migrations.ts";
import { OuiSqliteProductStore } from "../db/sqlite-product-store.ts";
import { OuiSqliteRunStore } from "../db/sqlite-store.ts";
import type { OuiAdapterModule } from "../shared/types.ts";
import { createOuiHttpServer, type OuiHttpServer } from "./http.ts";

let stores: OuiSqliteRunStore[] = [];
let servers: OuiHttpServer[] = [];

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
    async execute() {
      return { status: "succeeded" };
    },
  };
}

afterEach(async () => {
  for (const server of servers) {
    await server.close();
  }
  servers = [];
  for (const store of stores) {
    store.close();
  }
  stores = [];
});

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
    const server = createOuiHttpServer({
      store,
      productStore,
      registry: createOuiAdapterRegistry([createAdapter()]),
    });
    servers.push(server);
    const { port } = await server.listen(0, "127.0.0.1");

    const companyResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies/default`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyId: "company_1",
        openclawLeader: { id: "leader_1", label: "Lead" },
      }),
    });
    expect(companyResponse.status).toBe(200);

    const taskResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_1/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "task_1", title: "Coordinate work" }),
    });
    expect(taskResponse.status).toBe(201);

    const assignResponse = await fetch(`http://127.0.0.1:${port}/api/oui/tasks/task_1/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "leader_1" }),
    });
    expect(assignResponse.status).toBe(200);

    const runResponse = await fetch(`http://127.0.0.1:${port}/api/oui/tasks/task_1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "run_task_1", sessionKey: "main", message: "Do it" }),
    });
    const runBody = (await runResponse.json()) as { status?: string; run?: { id?: string } };
    expect(runResponse.status).toBe(202);
    expect(runBody).toMatchObject({ status: "queued", run: { id: "run_task_1" } });

    const timelineResponse = await fetch(`http://127.0.0.1:${port}/api/oui/tasks/task_1/timeline`);
    const timeline = (await timelineResponse.json()) as { runs?: Array<{ run?: { id?: string } }> };
    expect(timelineResponse.status).toBe(200);
    expect(timeline.runs?.[0].run?.id).toBe("run_task_1");
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

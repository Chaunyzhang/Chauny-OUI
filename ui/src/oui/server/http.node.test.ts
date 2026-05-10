// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createOuiAdapterRegistry } from "../adapters/registry.ts";
import { runOuiMigrations } from "../db/migrations.ts";
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

function createAdapter(): OuiAdapterModule {
  return {
    id: "openclaw-local",
    kind: "openclaw",
    label: "OpenClaw",
    capabilities: {
      execute: "available",
      cancel: "available",
      streamEvents: "available",
      listModels: "available",
      listAgents: "available",
      listSkills: "missing",
      usageQuery: "manual",
      localRuntime: "available",
      externalExecution: false,
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
});

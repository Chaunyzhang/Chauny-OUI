import { readFile, rm } from "node:fs/promises";
import * as path from "node:path";
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

    const companyReadResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies/company_1`);
    const companyReadBody = (await companyReadResponse.json()) as {
      tasks?: Array<{ id?: string }>;
    };
    expect(companyReadResponse.status).toBe(200);
    expect(companyReadBody.tasks?.map((task) => task.id)).toEqual(["task_1"]);

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

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/oui/companies`);
    const listBody = (await listResponse.json()) as {
      companies?: Array<{ id?: string }>;
      summaries?: Array<{
        company?: { id?: string };
        ceo?: { id?: string; adapterKind?: string };
        taskCount?: number;
        openInboxCount?: number;
      }>;
    };
    expect(listResponse.status).toBe(200);
    expect(listBody.companies?.map((company) => company.id)).toEqual(["company_product"]);
    expect(listBody.summaries?.[0]).toMatchObject({
      company: { id: "company_product" },
      ceo: { id: "ceo_product", adapterKind: "openclaw" },
      taskCount: 0,
      openInboxCount: 0,
    });
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
      controlRoom?: { nodes?: Array<{ title?: string; status?: string; sourceStatus?: string }> };
    };
    expect(startResponse.status).toBe(200);
    expect(startBody.version).toMatchObject({ status: "active" });
    expect(startBody.company).toMatchObject({ status: "running", currentStage: "Monitor" });
    expect(startBody.workNodes?.[0]).toMatchObject({
      title: "Monitor",
      status: "ready",
      orderIndex: 1,
    });
    expect(startBody.controlRoom?.nodes?.[0]).toMatchObject({
      title: "Monitor",
      status: "current",
      sourceStatus: "ready",
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
      status: "active",
    });
    expect(detailBody.workNodes?.[0]).toMatchObject({
      runbookVersionId: "runbook_control_v1",
      status: "ready",
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

  it("completes work nodes through the API and exposes stage artifacts", async () => {
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
          { id: "plan", title: "Plan" },
          { id: "ship", title: "Ship" },
        ],
      }),
    });
    const startResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/runbook-versions/runbook_nodes_v1/start`,
      { method: "POST", headers: { "content-type": "application/json" } },
    );
    const startBody = (await startResponse.json()) as {
      workNodes?: Array<{ id?: string; title?: string; status?: string }>;
    };
    expect(startResponse.status).toBe(200);
    expect(startBody.workNodes?.map((node) => node.status)).toEqual(["ready", "pending"]);

    const completeResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/work-nodes/${encodeURIComponent(
        startBody.workNodes?.[0]?.id ?? "",
      )}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          completedBy: "owner",
          summary: "Planning finished.",
          output: { decision: "continue" },
        }),
      },
    );
    const completeBody = (await completeResponse.json()) as {
      node?: { status?: string };
      nextNode?: { title?: string; status?: string };
      artifact?: { kind?: string; summary?: string; content?: Record<string, unknown> };
      controlRoom?: { artifactCount?: number; nodes?: Array<{ sourceStatus?: string }> };
    };
    expect(completeResponse.status).toBe(200);
    expect(completeBody.node).toMatchObject({ status: "done" });
    expect(completeBody.nextNode).toMatchObject({ title: "Ship", status: "ready" });
    expect(completeBody.artifact).toMatchObject({
      kind: "stage_output",
      summary: "Planning finished.",
      content: { decision: "continue", stageId: "plan" },
    });
    expect(completeBody.controlRoom?.artifactCount).toBe(1);
    expect(completeBody.controlRoom?.nodes?.map((node) => node.sourceStatus)).toEqual([
      "done",
      "ready",
    ]);

    const artifactsResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/companies/company_nodes/artifacts`,
    );
    const artifactsBody = (await artifactsResponse.json()) as {
      artifacts?: Array<{ kind?: string; title?: string }>;
    };
    expect(artifactsResponse.status).toBe(200);
    expect(artifactsBody.artifacts).toEqual([
      expect.objectContaining({ kind: "stage_output", title: "Plan output" }),
    ]);
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
        ],
      }),
    });
    expect(createResponse.status).toBe(201);

    const turnResponse = await fetch(
      `http://127.0.0.1:${port}/api/oui/meetings/meeting_strategy/turn`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "What should the CEO focus on?" }),
      },
    );
    const turnBody = (await turnResponse.json()) as {
      participantMessages?: Array<{ metadata?: { execution?: string } }>;
    };
    expect(turnResponse.status).toBe(201);
    expect(turnBody.participantMessages?.[0]?.metadata).toMatchObject({
      execution: "preview_disabled",
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

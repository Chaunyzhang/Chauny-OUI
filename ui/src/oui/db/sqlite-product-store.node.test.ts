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

function createTestCompany(
  store: OuiSqliteProductStore,
  companyId = "company_1",
  ceoId = "leader_1",
) {
  return store.createCompany({
    id: companyId,
    name: "Test Company",
    openclawCeo: {
      id: ceoId,
      label: "Lead",
      openclawAgentId: ceoId,
    },
  });
}

afterEach(() => {
  for (const db of databases) {
    db.close();
  }
  databases = [];
});

describe("OuiSqliteProductStore company and agents", () => {
  it("upgrades early company tables before indexing compatibility columns", async () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    db.exec(`
      CREATE TABLE oui_companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        default_leader_agent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO oui_companies(id, name, default_leader_agent_id, created_at, updated_at)
      VALUES (
        'legacy_company',
        'Legacy Company',
        NULL,
        '2026-05-10T00:00:00.000Z',
        '2026-05-10T00:00:00.000Z'
      );
    `);

    const store = new OuiSqliteProductStore(db);
    const legacy = await store.getCompany("legacy_company");

    expect(legacy).toMatchObject({
      id: "legacy_company",
      mode: "project",
      status: "idle",
      autonomyPolicy: {},
      reportingPreference: {},
    });
  });

  it("removes the empty legacy default company created by the old preview flow", async () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    db.exec(`
      CREATE TABLE oui_companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        default_leader_agent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO oui_companies(id, name, default_leader_agent_id, created_at, updated_at)
      VALUES (
        'default',
        'OUI Company',
        'openclaw-main',
        '2026-05-10T00:00:00.000Z',
        '2026-05-10T00:00:00.000Z'
      );
    `);

    const store = new OuiSqliteProductStore(db);

    expect(await store.getCompany("default")).toBeNull();
  });

  it("creates an explicit company with an OpenClaw CEO mapping", async () => {
    const store = createStore();

    const { company, ceo } = await store.createCompany({
      id: "company_1",
      name: "Chauny OUI",
      openclawCeo: {
        id: "leader_1",
        label: "Lead",
        openclawAgentId: "openclaw-main",
      },
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    expect(company.defaultLeaderAgentId).toBe("leader_1");
    expect(company).toMatchObject({
      mode: "project",
      status: "idle",
      ceoAgentId: "leader_1",
      autonomyPolicy: {},
      reportingPreference: {},
    });
    expect(ceo).toMatchObject({
      id: "leader_1",
      adapterKind: "openclaw",
      openclawAgentId: "openclaw-main",
      isLeader: true,
      status: "active",
    });
  });

  it("creates multiple OpenClaw-led companies without sharing agents", async () => {
    const store = createStore();

    const product = await store.createCompany({
      id: "company_product",
      name: "OUI Product Company",
      openclawCeo: {
        id: "ceo_product",
        label: "Product CEO",
        openclawAgentId: "product-main",
      },
      now: new Date("2026-05-10T00:00:00.000Z"),
    });
    const media = await store.createCompany({
      id: "company_media",
      name: "Media Company",
      openclawCeo: {
        id: "ceo_media",
        label: "Media CEO",
        openclawAgentId: "media-main",
      },
      now: new Date("2026-05-10T00:01:00.000Z"),
    });

    expect(product.company).toMatchObject({
      id: "company_product",
      ceoAgentId: "ceo_product",
      defaultLeaderAgentId: "ceo_product",
    });
    expect(media.company).toMatchObject({
      id: "company_media",
      mode: "project",
      ceoAgentId: "ceo_media",
    });
    expect((await store.listCompanies()).map((company) => company.id)).toEqual([
      "company_media",
      "company_product",
    ]);
    expect((await store.listAgents("company_product")).map((agent) => agent.id)).toEqual([
      "ceo_product",
    ]);
    expect((await store.listAgents("company_media")).map((agent) => agent.id)).toEqual([
      "ceo_media",
    ]);
  });

  it("stores company-scoped CEO conversations and messages", async () => {
    const store = createStore();
    await createTestCompany(store);

    const conversation = await store.getOrCreateCeoConversation({
      id: "ceo_conversation_1",
      companyId: "company_1",
      title: "Company direction",
      now: new Date("2026-05-10T00:02:00.000Z"),
    });
    const userMessage = await store.appendConversationMessage({
      id: "ceo_message_1",
      conversationId: conversation.id,
      companyId: "company_1",
      role: "user",
      content: "Build the company system.",
      metadata: { source: "owner" },
      now: new Date("2026-05-10T00:03:00.000Z"),
    });
    const assistantMessage = await store.appendConversationMessage({
      id: "ceo_message_2",
      conversationId: conversation.id,
      companyId: "company_1",
      role: "assistant",
      content: "I will shape this into a runbook.",
      now: new Date("2026-05-10T00:04:00.000Z"),
    });

    expect(await store.listCeoConversations("company_1")).toMatchObject([
      {
        id: "ceo_conversation_1",
        ceoAgentId: "leader_1",
        title: "Company direction",
        status: "active",
      },
    ]);
    expect(await store.listConversationMessages(conversation.id)).toEqual([
      userMessage,
      assistantMessage,
    ]);

    await createTestCompany(store, "company_2", "leader_2");
    await expect(
      store.appendConversationMessage({
        conversationId: conversation.id,
        companyId: "company_2",
        role: "user",
        content: "Cross company",
      }),
    ).rejects.toThrow(/inside one company/);
  });

  it("rejects non-OpenClaw CEOs", async () => {
    const store = createStore();
    await createTestCompany(store);
    const contractor = await store.createAgent({
      id: "contractor_1",
      companyId: "company_1",
      adapterId: "codex-local",
      adapterKind: "codex",
      label: "Codex Contractor",
    });

    expect(contractor.status).toBe("disabled");
    await expect(
      store.createAgent({
        id: "bad_ceo",
        companyId: "company_1",
        adapterId: "codex-local",
        adapterKind: "codex",
        label: "Bad CEO",
        isLeader: true,
      }),
    ).rejects.toThrow(/OpenClaw/);
    await expect(store.setDefaultLeaderAgent("company_1", "contractor_1")).rejects.toThrow(
      /OpenClaw/,
    );
  });

  it("defaults non-OpenClaw employees to disabled and prevents reports-to cycles", async () => {
    const store = createStore();
    await createTestCompany(store);

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

describe("OuiSqliteProductStore runbooks and inbox", () => {
  it("creates and approves runbook drafts", async () => {
    const store = createStore();
    await store.createCompany({
      id: "company_1",
      name: "OUI Product Company",
      openclawCeo: {
        id: "ceo_1",
        label: "CEO",
        openclawAgentId: "main",
      },
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    const draft = await store.createRunbookDraft({
      id: "runbook_1",
      versionId: "runbook_1_v1",
      companyId: "company_1",
      title: "Build company system",
      sourceType: "ceo_chat",
      objective: "Turn OUI into an agent company system.",
      stages: [{ id: "understand", title: "Product understanding" }],
      now: new Date("2026-05-10T00:02:00.000Z"),
    });
    expect(draft.runbook).toMatchObject({ id: "runbook_1", status: "draft" });
    expect(draft.version).toMatchObject({
      id: "runbook_1_v1",
      status: "draft",
      version: 1,
      stages: [{ id: "understand", title: "Product understanding" }],
    });

    const approved = await store.approveRunbookVersion(
      "runbook_1_v1",
      "user",
      new Date("2026-05-10T00:03:00.000Z"),
    );
    const company = await store.getCompany("company_1");

    expect(approved).toMatchObject({ status: "approved", approvedBy: "user" });
    expect((await store.listRunbooks("company_1"))[0]).toMatchObject({
      id: "runbook_1",
      status: "approved",
      activeVersionId: "runbook_1_v1",
    });
    expect(company).toMatchObject({
      currentRunbookVersionId: "runbook_1_v1",
      currentObjective: "Turn OUI into an agent company system.",
      currentStage: "Product understanding",
    });

    const started = await store.startRunbookVersion(
      "runbook_1_v1",
      "user",
      new Date("2026-05-10T00:04:00.000Z"),
    );
    expect(started.version).toMatchObject({ status: "active", approvedBy: "user" });
    expect(started.runbook).toMatchObject({
      status: "active",
      activeVersionId: "runbook_1_v1",
    });
    expect(started.company).toMatchObject({
      status: "running",
      currentRunbookVersionId: "runbook_1_v1",
      currentStage: "Product understanding",
    });
    expect(started.workNodes).toEqual([
      expect.objectContaining({
        runbookVersionId: "runbook_1_v1",
        stageId: "understand",
        title: "Product understanding",
        status: "ready",
        orderIndex: 1,
      }),
    ]);
    await expect(store.listWorkNodes("company_2")).resolves.toEqual([]);
  });

  it("completes work nodes, saves artifacts, and advances the runbook", async () => {
    const store = createStore();
    await store.createCompany({
      id: "company_1",
      name: "OUI Product Company",
      openclawCeo: {
        id: "ceo_1",
        label: "CEO",
        openclawAgentId: "main",
      },
      now: new Date("2026-05-10T00:00:00.000Z"),
    });
    await store.createRunbookDraft({
      id: "runbook_1",
      versionId: "runbook_1_v1",
      companyId: "company_1",
      title: "Build company system",
      sourceType: "ceo_chat",
      objective: "Turn OUI into an agent company system.",
      stages: [
        { id: "plan", title: "Plan product shape" },
        { id: "build", title: "Build monitored slice" },
      ],
      now: new Date("2026-05-10T00:01:00.000Z"),
    });

    const started = await store.startRunbookVersion(
      "runbook_1_v1",
      "user",
      new Date("2026-05-10T00:02:00.000Z"),
    );
    expect(started.workNodes.map((node) => [node.title, node.status])).toEqual([
      ["Plan product shape", "ready"],
      ["Build monitored slice", "pending"],
    ]);

    const first = await store.completeWorkNode({
      nodeId: started.workNodes[0].id,
      completedBy: "owner",
      summary: "Plan is accepted.",
      output: { decision: "continue" },
      now: new Date("2026-05-10T00:03:00.000Z"),
    });
    expect(first.node).toMatchObject({ title: "Plan product shape", status: "done" });
    expect(first.nextNode).toMatchObject({ title: "Build monitored slice", status: "ready" });
    expect(first.artifact).toMatchObject({
      companyId: "company_1",
      kind: "stage_output",
      title: "Plan product shape output",
      summary: "Plan is accepted.",
    });
    expect(first.artifact.content).toMatchObject({
      decision: "continue",
      nodeId: started.workNodes[0].id,
      stageId: "plan",
    });
    expect(await store.getCompany("company_1")).toMatchObject({
      status: "running",
      currentStage: "Build monitored slice",
    });

    const repeatedFirst = await store.completeWorkNode({
      nodeId: started.workNodes[0].id,
      completedBy: "owner",
      summary: "Plan remains accepted.",
      output: { decision: "continue" },
      now: new Date("2026-05-10T00:03:30.000Z"),
    });
    expect(repeatedFirst.nextNode).toMatchObject({
      title: "Build monitored slice",
      status: "ready",
    });
    expect(repeatedFirst.company).toMatchObject({
      status: "running",
      currentStage: "Build monitored slice",
    });
    expect(repeatedFirst.runbook).toMatchObject({ status: "active" });
    expect(await store.listArtifacts({ companyId: "company_1" })).toHaveLength(1);

    const second = await store.completeWorkNode({
      nodeId: first.nextNode?.id ?? "",
      completedBy: "owner",
      summary: "Build slice is done.",
      now: new Date("2026-05-10T00:04:00.000Z"),
    });
    expect(second.nextNode).toBeNull();
    expect(second.company).toMatchObject({ status: "idle", currentStage: "Completed" });
    expect(second.runbook).toMatchObject({ status: "completed" });
    expect(second.version).toMatchObject({ status: "completed" });
    expect(
      (await store.listArtifacts({ companyId: "company_1" })).map((item) => item.kind),
    ).toEqual(["stage_output", "stage_output"]);
  });

  it("keeps inbox items inside one company and resolves them", async () => {
    const store = createStore();
    await store.createCompany({
      id: "company_1",
      name: "Company 1",
      openclawCeo: { id: "ceo_1", label: "CEO 1", openclawAgentId: "main" },
    });
    await store.createCompany({
      id: "company_2",
      name: "Company 2",
      openclawCeo: { id: "ceo_2", label: "CEO 2", openclawAgentId: "other" },
    });
    await store.createTask({ id: "task_1", companyId: "company_1", title: "Choose direction" });

    const item = await store.createInboxItem({
      id: "inbox_1",
      companyId: "company_1",
      itemType: "approval",
      title: "Approve next stage",
      taskId: "task_1",
      payload: { options: ["continue"] },
      createdBy: "ceo_1",
    });

    expect(await store.listInboxItems("company_1", "open")).toEqual([item]);
    await expect(
      store.createInboxItem({
        id: "inbox_bad",
        companyId: "company_2",
        itemType: "approval",
        title: "Cross-company task",
        taskId: "task_1",
      }),
    ).rejects.toThrow(/inside one company/);

    const resolved = await store.resolveInboxItem({
      itemId: "inbox_1",
      action: "reply",
      responseText: "Continue, but report risks first.",
      actorId: "user",
    });
    expect(resolved).toMatchObject({
      status: "resolved",
      resolvedBy: "user",
      resolution: { action: "reply", responseText: "Continue, but report risks first." },
    });
    expect(await store.listInboxItems("company_1", "open")).toEqual([]);
  });
});

describe("OuiSqliteProductStore meetings and artifacts", () => {
  it("keeps meeting room records global and stores minutes artifacts", async () => {
    const store = createStore();

    const meeting = await store.createMeeting({
      id: "meeting_1",
      title: "Discuss company strategy",
      objective: "Compare product options.",
      participants: [
        {
          id: "main",
          label: "Main",
          adapterKind: "openclaw",
          adapterId: "openclaw-local",
          openclawAgentId: "main",
          muted: false,
          speakingOrder: 1,
          thinkingIntensity: "medium",
        },
      ],
      now: new Date("2026-05-10T00:00:00.000Z"),
    });
    expect(meeting).toMatchObject({
      id: "meeting_1",
      status: "draft",
      discussion: {
        currentRound: 0,
        phase: "drafting",
      },
      participants: [
        expect.objectContaining({
          adapterKind: "openclaw",
          muted: false,
          speakingOrder: 1,
          thinkingIntensity: "medium",
        }),
      ],
    });

    await store.updateMeetingParticipants({
      meetingId: "meeting_1",
      participants: [
        {
          id: "main",
          label: "Main",
          adapterKind: "openclaw",
          adapterId: "openclaw-local",
          openclawAgentId: "main",
          muted: true,
          speakingOrder: 2,
          thinkingIntensity: "low",
        },
        {
          id: "analyst",
          label: "Analyst",
          adapterKind: "openclaw",
          adapterId: "openclaw-local",
          openclawAgentId: "analyst",
          muted: false,
          speakingOrder: 1,
          thinkingIntensity: "high",
        },
      ],
      now: new Date("2026-05-10T00:00:30.000Z"),
    });

    await store.updateMeetingStatus({
      meetingId: "meeting_1",
      status: "active",
      now: new Date("2026-05-10T00:01:00.000Z"),
    });
    await store.appendMeetingMessage({
      id: "message_owner",
      meetingId: "meeting_1",
      role: "owner",
      content: "What should we build first?",
      now: new Date("2026-05-10T00:02:00.000Z"),
    });
    await store.appendMeetingMessage({
      id: "message_main",
      meetingId: "meeting_1",
      role: "participant",
      participantId: "main",
      content: "Start with the control room.",
      now: new Date("2026-05-10T00:03:00.000Z"),
    });
    const artifact = await store.createArtifact({
      id: "meeting_1_minutes",
      meetingId: "meeting_1",
      kind: "meeting_minutes",
      title: "Discuss company strategy minutes",
      contentType: "text/markdown",
      content: { path: "meetings/meeting_1.md" },
      metadata: { source: "meeting_room" },
      now: new Date("2026-05-10T00:04:00.000Z"),
    });
    await store.updateMeetingStatus({
      meetingId: "meeting_1",
      status: "ended",
      minutesArtifactId: artifact.id,
      now: new Date("2026-05-10T00:05:00.000Z"),
    });

    expect((await store.listMeetings())[0]).toMatchObject({
      id: "meeting_1",
      status: "ended",
      minutesArtifactId: "meeting_1_minutes",
      discussion: {
        currentRound: 0,
        phase: "drafting",
      },
      participants: [
        expect.objectContaining({
          id: "main",
          muted: true,
          speakingOrder: 2,
          thinkingIntensity: "low",
        }),
        expect.objectContaining({
          id: "analyst",
          muted: false,
          speakingOrder: 1,
          thinkingIntensity: "high",
        }),
      ],
    });
    expect((await store.listMeetingMessages("meeting_1")).map((message) => message.id)).toEqual([
      "message_owner",
      "message_main",
    ]);
    expect(await store.listArtifacts({ meetingId: "meeting_1" })).toEqual([artifact]);
  });
});

describe("OuiSqliteProductStore tasks", () => {
  it("tracks assignment readiness through dependencies and review transitions", async () => {
    const store = createStore();
    await createTestCompany(store);
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
    const requestedAgain = await store.transitionTaskReview(task.id, "requested");
    const approved = await store.transitionTaskReview(requestedAgain.id, "approved");
    expect(approved).toMatchObject({ status: "done", reviewState: "approved" });

    expect((await store.listTasks("company_1")).map((entry) => entry.id)).toContain("task_main");
  });

  it("rejects dependency cycles", async () => {
    const store = createStore();
    await createTestCompany(store);
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
    await createTestCompany(store);
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

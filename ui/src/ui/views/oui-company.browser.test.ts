import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { OuiAgentRecord, OuiCompanyRecord } from "../../oui/shared/product-types.ts";
import { formatOuiCompanyError } from "../oui-company-copy.ts";
import { renderOuiCompany } from "./oui-company.ts";

const now = "2026-05-10T00:00:00.000Z";

function companyRecord(overrides: Partial<OuiCompanyRecord> = {}): OuiCompanyRecord {
  return {
    id: "default",
    name: "OUI Company",
    description: null,
    mode: "project",
    status: "idle",
    ceoAgentId: "openclaw-alpha",
    defaultLeaderAgentId: "openclaw-alpha",
    currentRunbookVersionId: null,
    currentObjective: null,
    currentStage: null,
    autonomyPolicy: {},
    reportingPreference: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function openclawAgent(overrides: Partial<OuiAgentRecord> = {}): OuiAgentRecord {
  return {
    id: "openclaw-alpha",
    companyId: "default",
    adapterId: "openclaw-local",
    adapterKind: "openclaw",
    label: "Alpha Leader",
    roleId: null,
    reportsToAgentId: null,
    openclawAgentId: "alpha",
    modelRef: null,
    status: "active",
    isLeader: true,
    config: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("OUI company view", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(async () => {
    await i18n.setLocale("en");
  });

  it("renders the company dashboard, selected company records, and run timeline", async () => {
    const onCreateTask = vi.fn();
    const onCreateCompany = vi.fn();
    const onQueueRun = vi.fn();
    const onSelectCompany = vi.fn();
    const company = companyRecord({
      currentObjective: "Build the company dashboard",
      currentStage: "Dashboard",
    });
    const agent = openclawAgent();
    const task = {
      id: "task-1",
      companyId: "default",
      title: "Build P1 board",
      description: "Visible task flow",
      status: "ready" as const,
      reviewState: "requested" as const,
      assignedAgentId: "openclaw-alpha",
      createdBy: null,
      priority: 0,
      createdAt: now,
      updatedAt: now,
    };
    const runbook = {
      id: "runbook-1",
      companyId: "default",
      title: "Build company system",
      status: "approved" as const,
      activeVersionId: "runbook-version-1",
      createdAt: now,
      updatedAt: now,
    };
    const activeRunbookVersion = {
      id: "runbook-version-1",
      runbookId: "runbook-1",
      companyId: "default",
      version: 1,
      sourceType: "ceo_chat" as const,
      sourceRef: null,
      status: "approved" as const,
      objective: "Build the company dashboard",
      operatingMode: "project" as const,
      stages: [{ id: "dashboard", title: "Dashboard" }],
      decisionPoints: [],
      artifactPolicy: {},
      pausePolicy: {},
      reportPolicy: {},
      markdownPath: null,
      approvedBy: "user",
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const workNode = {
      id: "runbook-version-1:node:1",
      companyId: "default",
      runbookVersionId: "runbook-version-1",
      stageId: "dashboard",
      title: "Dashboard",
      nodeType: "work",
      status: "ready" as const,
      assignedAgentId: "openclaw-alpha",
      orderIndex: 1,
      summary: "Build dashboard shell",
      input: {},
      output: {},
      runId: null,
      inboxItemId: null,
      createdAt: now,
      updatedAt: now,
    };
    const inboxItem = {
      id: "inbox-1",
      companyId: "default",
      itemType: "approval" as const,
      status: "open" as const,
      title: "Approve next stage",
      summary: "Ready for owner review",
      runbookVersionId: "runbook-version-1",
      taskId: "task-1",
      runId: null,
      payload: {},
      resolution: null,
      createdBy: "openclaw-alpha",
      resolvedBy: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const ceoConversation = {
      id: "ceo-conversation-1",
      companyId: "default",
      ceoAgentId: "openclaw-alpha",
      title: "Company direction",
      summary: null,
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    };
    const ceoMessages = [
      {
        id: "ceo-message-1",
        conversationId: "ceo-conversation-1",
        companyId: "default",
        role: "user" as const,
        content: "We should build the company system.",
        metadata: {},
        createdAt: now,
      },
      {
        id: "ceo-message-2",
        conversationId: "ceo-conversation-1",
        companyId: "default",
        role: "assistant" as const,
        content: "I will turn this into a runbook draft.",
        metadata: {},
        createdAt: now,
      },
    ];
    const container = document.createElement("div");

    render(
      renderOuiCompany({
        loading: false,
        busy: false,
        apiAvailable: true,
        error: null,
        message: null,
        companySummaries: [
          {
            company,
            ceo: agent,
            taskCount: 1,
            openInboxCount: 1,
            activeRunbook: runbook,
            latestActivityAt: now,
          },
          {
            company: companyRecord({
              id: "media",
              name: "Media Company",
              ceoAgentId: "openclaw-media",
              defaultLeaderAgentId: "openclaw-media",
              status: "waiting_user",
              currentObjective: "Daily topics",
              currentStage: "Selection",
            }),
            ceo: null,
            taskCount: 3,
            openInboxCount: 2,
            activeRunbook: null,
            latestActivityAt: now,
          },
        ],
        company,
        ceoCandidates: [{ id: "alpha", label: "Alpha Leader", modelRef: "model-a" }],
        agents: [agent],
        ceoConversations: [ceoConversation],
        ceoMessages,
        runbooks: [runbook],
        runbookVersions: [activeRunbookVersion],
        activeRunbookVersion,
        workNodes: [workNode],
        inboxItems: [inboxItem],
        controlRoom: {
          companyId: "default",
          status: "idle",
          ceo: agent,
          currentObjective: "Build the company dashboard",
          currentStage: "Dashboard",
          activeRunbook: runbook,
          activeRunbookVersion,
          openInboxItems: [inboxItem],
          nodes: [
            {
              id: "dashboard",
              title: "Dashboard",
              status: "current",
              kind: "stage",
              assigneeLabel: "Alpha Leader",
              summary: "Build dashboard shell",
              updatedAt: now,
            },
          ],
          nextStep: "Review the open inbox items before the company continues.",
          updatedAt: now,
        },
        adapters: [
          {
            adapterId: "codex-local",
            kind: "codex",
            label: "Codex Employee",
            enabled: true,
            executable: false,
            reason: "External adapter execution is disabled.",
          },
        ],
        tasks: [task],
        timeline: {
          task,
          readiness: { ready: true, pendingDependencyIds: [] },
          runs: [
            {
              link: { taskId: "task-1", runId: "run-1", kind: "primary", createdAt: now },
              run: {
                id: "run-1",
                adapterId: "openclaw-local",
                adapterKind: "openclaw",
                agentId: "openclaw-alpha",
                sessionKey: "main",
                status: "running",
                input: {},
                attempts: 0,
                maxAttempts: 1,
                queuedAt: now,
                updatedAt: now,
                result: { usage: { inputTokens: 3 } },
              },
              logs: [
                {
                  id: "log-1",
                  runId: "run-1",
                  seq: 1,
                  level: "info",
                  message: "started",
                  createdAt: now,
                },
              ],
              costEvents: [],
            },
          ],
        },
        selectedTaskId: "task-1",
        createCompanyName: "Research Company",
        createCompanyCeoId: "alpha",
        ceoDraft: "Next direction",
        draftTitle: "New task",
        draftDescription: "",
        draftAgentId: "",
        onRefresh: vi.fn(),
        onSelectCompany,
        onCreateCompanyNameChange: vi.fn(),
        onCreateCompanyCeoChange: vi.fn(),
        onCreateCompany,
        onCeoDraftChange: vi.fn(),
        onSendCeoMessage: vi.fn(),
        onGenerateRunbookDraft: vi.fn(),
        onStartRunbookVersion: vi.fn(),
        onDraftTitleChange: vi.fn(),
        onDraftDescriptionChange: vi.fn(),
        onDraftAgentChange: vi.fn(),
        onCreateTask,
        onSelectTask: vi.fn(),
        onAssignTask: vi.fn(),
        onQueueRun,
        onReviewTransition: vi.fn(),
        onOpenCeoChat: vi.fn(),
        onOpenParallelChat: vi.fn(),
      }),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Company dashboard");
    expect(container.textContent).toContain("Your AI companies");
    expect(container.textContent).toContain("New company");
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>("input")).some(
        (input) => input.value === "Research Company",
      ),
    ).toBe(true);
    expect(container.textContent).toContain("Build the company dashboard");
    expect(container.textContent).toContain("Media Company");
    expect(container.textContent).toContain("Control room");
    expect(container.textContent).toContain("CEO private chat");
    expect(container.textContent).toContain("We should build the company system.");
    expect(container.textContent).toContain("Generate runbook draft");
    expect(container.textContent).toContain("Inbox center");
    expect(container.textContent).toContain("Runbooks");
    expect(container.textContent).toContain("Build company system");
    expect(container.textContent).toContain("Approve next stage");
    expect(container.querySelector(".oui-company__agent-card--leader")?.textContent).toContain(
      "Alpha Leader",
    );
    expect(container.textContent).toContain("Codex Employee");
    expect(container.textContent).toContain("External adapter execution is disabled.");
    expect(container.textContent).toContain("Internal records");
    expect(container.textContent).toContain("Build P1 board");
    expect(container.textContent).toContain("run-1");
    expect(container.textContent).toContain("started");

    container.querySelector<HTMLButtonElement>(".oui-company__create-button")?.click();
    expect(onCreateTask).toHaveBeenCalledTimes(1);

    const createCompanyButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Create company"));
    createCompanyButton?.click();
    expect(onCreateCompany).toHaveBeenCalledTimes(1);

    const runButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Run"),
    );
    runButton?.click();
    expect(onQueueRun).toHaveBeenCalledWith("task-1");

    const mediaCard = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".oui-company__company-card"),
    ).find((button) => button.textContent?.includes("Media Company"));
    mediaCard?.click();
    expect(onSelectCompany).toHaveBeenCalledWith("media");
  });

  it("uses Chinese copy for the disconnected OUI company dashboard state", async () => {
    await i18n.setLocale("zh-CN");
    const container = document.createElement("div");
    const apiError = formatOuiCompanyError(new Error("OUI API request failed: 404"));

    render(
      renderOuiCompany({
        loading: false,
        busy: false,
        apiAvailable: false,
        error: apiError,
        message: null,
        companySummaries: [],
        company: null,
        ceoCandidates: [],
        agents: [],
        ceoConversations: [],
        ceoMessages: [],
        runbooks: [],
        runbookVersions: [],
        activeRunbookVersion: null,
        workNodes: [],
        inboxItems: [],
        controlRoom: null,
        adapters: [],
        tasks: [],
        timeline: null,
        selectedTaskId: null,
        createCompanyName: "",
        createCompanyCeoId: "",
        ceoDraft: "",
        draftTitle: "",
        draftDescription: "",
        draftAgentId: "",
        onRefresh: vi.fn(),
        onSelectCompany: vi.fn(),
        onCreateCompanyNameChange: vi.fn(),
        onCreateCompanyCeoChange: vi.fn(),
        onCreateCompany: vi.fn(),
        onCeoDraftChange: vi.fn(),
        onSendCeoMessage: vi.fn(),
        onGenerateRunbookDraft: vi.fn(),
        onStartRunbookVersion: vi.fn(),
        onDraftTitleChange: vi.fn(),
        onDraftDescriptionChange: vi.fn(),
        onDraftAgentChange: vi.fn(),
        onCreateTask: vi.fn(),
        onSelectTask: vi.fn(),
        onAssignTask: vi.fn(),
        onQueueRun: vi.fn(),
        onReviewTransition: vi.fn(),
        onOpenCeoChat: vi.fn(),
        onOpenParallelChat: vi.fn(),
      }),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("四宫格聊天");
    expect(container.textContent).toContain("公司总看板");
    expect(container.textContent).toContain("OUI 后端 API 不可用（HTTP 404）。");
    expect(container.textContent).toContain("OUI 服务未连接。公司操作需要 OUI 服务。");
    expect(container.textContent).toContain("暂无公司");
    expect(container.textContent).toContain("未连接");
    expect(container.textContent).toContain("内部记录");
    expect(container.textContent).not.toContain("预览模式");
  });
});

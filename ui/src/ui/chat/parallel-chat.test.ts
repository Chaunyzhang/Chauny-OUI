import { describe, expect, it, vi } from "vitest";
import {
  createOuiTaskFromParallelPane,
  type OuiCompanyUiState,
} from "../controllers/oui-company.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  ensureParallelChatPanes,
  handleParallelAgentEvent,
  sendParallelChatPaneMessage,
  type ParallelChatHost,
} from "./parallel-chat.ts";

function createHost(overrides?: Partial<ParallelChatHost>): ParallelChatHost {
  return {
    client: null,
    connected: true,
    agentsList: { agents: [], defaultId: "main", mainKey: "main", scope: "user" },
    sessionsResult: null,
    chatModelOverrides: {},
    chatParallelPanes: [],
    requestUpdate: vi.fn(),
    ...overrides,
  };
}

describe("parallel chat", () => {
  it("routes live tool events to the matching pane", () => {
    const host = createHost();
    ensureParallelChatPanes(host);
    const [targetPane, otherPane] = host.chatParallelPanes;
    targetPane.chatRunId = "run-1";
    targetPane.chatStream = "Before the tool";
    targetPane.chatStreamStartedAt = Date.now();

    handleParallelAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "tool",
      ts: 123,
      sessionKey: targetPane.sessionKey,
      data: {
        phase: "result",
        toolCallId: "tool-1",
        name: "read",
        result: { text: "tool output" },
      },
    });

    expect(targetPane.chatStream).toBeNull();
    expect(targetPane.chatStreamSegments).toEqual([
      expect.objectContaining({ text: "Before the tool" }),
    ]);
    expect(targetPane.chatToolMessages).toHaveLength(1);
    expect(targetPane.chatToolMessages[0]).toMatchObject({
      role: "assistant",
      toolCallId: "tool-1",
      runId: "run-1",
      content: [
        { type: "toolcall", name: "read" },
        { type: "toolresult", name: "read", text: "tool output" },
      ],
    });
    expect(otherPane.chatToolMessages).toEqual([]);
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it("sends pane messages without a shared front-end queue", async () => {
    const pending: Array<{
      method: string;
      params: Record<string, unknown>;
      resolve: (value: unknown) => void;
    }> = [];
    const client = {
      request: vi.fn((method: string, params: Record<string, unknown>) => {
        return new Promise((resolve) => {
          pending.push({ method, params, resolve });
        });
      }),
    } as unknown as GatewayBrowserClient;
    const host = createHost({ client });
    ensureParallelChatPanes(host);

    host.chatParallelPanes[0].chatMessage = "first";
    host.chatParallelPanes[1].chatMessage = "second";

    const first = sendParallelChatPaneMessage(host, "parallel-1");
    const second = sendParallelChatPaneMessage(host, "parallel-2");

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(pending.map((entry) => entry.method)).toEqual(["chat.send", "chat.send"]);
    expect(pending[0]?.params.sessionKey).not.toEqual(pending[1]?.params.sessionKey);

    for (const entry of pending) {
      entry.resolve({ runId: "accepted" });
    }
    await Promise.all([first, second]);
  });

  it("creates a task from one pane without broadcasting a chat send", async () => {
    const client = {
      request: vi.fn(),
    } as unknown as GatewayBrowserClient;
    const host = createHost({
      client,
      agentsList: {
        agents: [
          { id: "alpha", name: "Alpha" },
          { id: "beta", name: "Beta" },
        ],
        defaultId: "alpha",
        mainKey: "agent:alpha:main",
        scope: "all",
      },
    });
    ensureParallelChatPanes(host);
    host.chatParallelPanes[0].chatMessage = "Draft a release plan";

    const company = {
      id: "company_1",
      name: "Product Company",
      description: null,
      mode: "project" as const,
      status: "idle" as const,
      ceoAgentId: "ceo_1",
      defaultLeaderAgentId: "ceo_1",
      currentRunbookVersionId: null,
      currentObjective: null,
      currentStage: null,
      autonomyPolicy: {},
      reportingPreference: {},
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    const ceo = {
      id: "ceo_1",
      companyId: "company_1",
      adapterId: "openclaw-local",
      adapterKind: "openclaw" as const,
      label: "Alpha",
      roleId: null,
      reportsToAgentId: null,
      openclawAgentId: "alpha",
      modelRef: null,
      status: "active" as const,
      isLeader: true,
      config: {},
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
    const task = {
      id: "task-1",
      companyId: "company_1",
      title: "Draft a release plan",
      description: "Created from four-pane 1: agent:alpha:main:parallel-1",
      status: "ready",
      reviewState: "none",
      assignedAgentId: "ceo_1",
      createdBy: null,
      priority: 0,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/oui/companies/company_1/tasks") && init?.method === "POST") {
        return Response.json({ task }, { status: 201 });
      }
      if (url.endsWith("/api/oui/companies/company_1")) {
        return Response.json({ company, agents: [ceo], tasks: [task] });
      }
      if (url.endsWith("/api/oui/tasks/task-1/timeline")) {
        return Response.json({
          task,
          readiness: { ready: true, pendingDependencyIds: [] },
          runs: [],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await createOuiTaskFromParallelPane(
        {
          ...host,
          ouiCompanyLoading: false,
          ouiCompanyBusy: false,
          ouiCompanyApiAvailable: true,
          ouiCompanyError: null,
          ouiCompanyMessage: null,
          ouiCompanySummaries: [
            {
              company,
              ceo,
              taskCount: 0,
              openInboxCount: 0,
              activeRunbook: null,
              latestActivityAt: company.updatedAt,
            },
          ],
          ouiCompanyRecord: company,
          ouiCompanyAgents: [ceo],
          ouiCompanyCeoConversations: [],
          ouiCompanyCeoMessages: [],
          ouiCompanyTasks: [],
          ouiCompanyRunbooks: [],
          ouiCompanyRunbookVersions: [],
          ouiCompanyActiveRunbookVersion: null,
          ouiCompanyWorkNodes: [],
          ouiCompanyInboxItems: [],
          ouiCompanyControlRoom: null,
          ouiCompanyAdapters: [],
          ouiCompanyTimeline: null,
          ouiCompanySelectedTaskId: null,
          ouiCreateCompanyName: "",
          ouiCreateCompanyCeoId: "",
          ouiCompanyCeoDraft: "",
          ouiCompanyCeoConversationId: null,
          ouiTaskDraftTitle: "",
          ouiTaskDraftDescription: "",
          ouiTaskDraftAgentId: "",
        } satisfies OuiCompanyUiState,
        "parallel-1",
      );
    } finally {
      globalThis.fetch = previousFetch;
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/oui/companies/company_1/tasks",
      expect.objectContaining({ method: "POST" }),
    );
    expect(client.request).not.toHaveBeenCalledWith("chat.send", expect.anything());
  });
});

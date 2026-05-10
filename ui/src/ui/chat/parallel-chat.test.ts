import { describe, expect, it, vi } from "vitest";
import {
  createOuiTaskFromParallelPane,
  ouiOpenClawAgentRecordId,
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
      id: "default",
      name: "OUI Company",
      defaultLeaderAgentId: ouiOpenClawAgentRecordId("alpha"),
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    const task = {
      id: "task-1",
      companyId: "default",
      title: "Draft a release plan",
      description: "Created from four-pane 1: agent:alpha:main:parallel-1",
      status: "ready",
      reviewState: "none",
      assignedAgentId: ouiOpenClawAgentRecordId("alpha"),
      createdBy: null,
      priority: 0,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/oui/companies/default") && init?.method === "POST") {
        return Response.json({ company, leader: null });
      }
      if (url.endsWith("/api/oui/companies/default") && !init?.method) {
        return Response.json({ company, agents: [], tasks: [] });
      }
      if (url.endsWith("/api/oui/companies/default/agents") && init?.method === "POST") {
        return Response.json({ agent: null }, { status: 201 });
      }
      if (url.endsWith("/api/oui/companies/default/tasks") && init?.method === "POST") {
        return Response.json({ task }, { status: 201 });
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
          ouiCompanyApiAvailable: false,
          ouiCompanyError: null,
          ouiCompanyMessage: null,
          ouiCompanyRecord: null,
          ouiCompanyAgents: [],
          ouiCompanyTasks: [],
          ouiCompanyAdapters: [],
          ouiCompanyTimeline: null,
          ouiCompanySelectedTaskId: null,
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
      "/api/oui/companies/default/tasks",
      expect.objectContaining({ method: "POST" }),
    );
    expect(client.request).not.toHaveBeenCalledWith("chat.send", expect.anything());
  });
});

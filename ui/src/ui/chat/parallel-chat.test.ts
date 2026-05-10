import { describe, expect, it, vi } from "vitest";
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
});

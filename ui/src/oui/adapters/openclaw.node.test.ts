// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { GatewayHelloOk } from "../../ui/gateway.ts";
import type { OuiRunRecord } from "../shared/types.ts";
import {
  createOpenClawAdapter,
  type OpenClawAdapterOptions,
  type OpenClawGatewayEvent,
} from "./openclaw.ts";

function createRun(input: Record<string, unknown>): OuiRunRecord {
  const now = "2026-05-10T00:00:00.000Z";
  return {
    id: "run_1",
    adapterId: "openclaw-local",
    adapterKind: "openclaw",
    status: "running",
    input,
    attempts: 1,
    maxAttempts: 1,
    queuedAt: now,
    updatedAt: now,
  };
}

const hello: GatewayHelloOk = {
  type: "hello-ok",
  protocol: 4,
  auth: { role: "operator", scopes: ["operator.read"] },
  features: { methods: ["chat.send", "chat.abort", "models.list"], events: ["chat"] },
};

describe("OpenClaw adapter", () => {
  it("dispatches through chat.send and resolves from terminal chat events", async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const listeners = new Set<(event: OpenClawGatewayEvent) => void>();
    const client: OpenClawAdapterOptions["client"] = {
      async request<T = unknown>(method: string, params?: unknown): Promise<T> {
        requests.push({ method, params });
        if (method === "chat.send") {
          queueMicrotask(() => {
            for (const listener of listeners) {
              listener({
                event: "chat",
                payload: { runId: "run_1", state: "final", message: { role: "assistant" } },
              });
            }
          });
        }
        return { status: "started" } as T;
      },
      addEventListener(listener: (event: OpenClawGatewayEvent) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const adapter = createOpenClawAdapter({ client, hello, terminalEventTimeoutMs: 100 });

    const result = await adapter.execute({
      run: createRun({ sessionKey: "main", message: "hello" }),
      log: () => undefined,
    });

    expect(result.status).toBe("succeeded");
    expect(requests[0]).toEqual({
      method: "chat.send",
      params: {
        sessionKey: "main",
        message: "hello",
        deliver: false,
        idempotencyKey: "run_1",
      },
    });
  });

  it("does not pretend accepted OpenClaw runs are complete without a terminal event", async () => {
    const client: OpenClawAdapterOptions["client"] = {
      async request<T = unknown>(): Promise<T> {
        return { status: "started" } as T;
      },
    };
    const adapter = createOpenClawAdapter({ client, hello, terminalEventTimeoutMs: 1 });

    const result = await adapter.execute({
      run: createRun({ sessionKey: "main", message: "hello" }),
      log: () => undefined,
    });

    expect(result.status).toBe("blocked");
    expect(result.resultJson).toEqual({ mode: "accepted_without_terminal_event" });
  });
});

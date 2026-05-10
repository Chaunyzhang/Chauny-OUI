import type { GatewayHelloOk } from "../../ui/gateway.ts";
import type {
  OuiAdapterExecutionContext,
  OuiAdapterExecutionResult,
  OuiAdapterModule,
  OuiJsonObject,
  OuiModelRef,
} from "../shared/types.ts";
import { buildOpenClawCompatSnapshot } from "./openclaw-compat.ts";

type OpenClawGatewayRequestClient = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
};

export type OpenClawGatewayEvent = {
  method?: string;
  event?: string;
  type?: string;
  payload?: unknown;
};

type OpenClawGatewayEventClient = {
  addEventListener?(listener: (event: OpenClawGatewayEvent) => void): () => void;
};

export type OpenClawAdapterOptions = {
  id?: string;
  label?: string;
  client: OpenClawGatewayRequestClient & OpenClawGatewayEventClient;
  hello?: GatewayHelloOk | null;
  terminalEventTimeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractRunInput(runInput: OuiJsonObject): {
  message: string;
  sessionKey: string;
  sessionId?: string;
} {
  const message = typeof runInput.message === "string" ? runInput.message.trim() : "";
  const sessionKey = typeof runInput.sessionKey === "string" ? runInput.sessionKey.trim() : "";
  const sessionId = typeof runInput.sessionId === "string" ? runInput.sessionId.trim() : "";
  if (!message) {
    throw new Error("OpenClaw adapter run input requires message.");
  }
  if (!sessionKey) {
    throw new Error("OpenClaw adapter run input requires sessionKey.");
  }
  return { message, sessionKey, ...(sessionId ? { sessionId } : {}) };
}

function normalizeChatEvent(event: OpenClawGatewayEvent): Record<string, unknown> | null {
  const payload = event.payload;
  if (!isRecord(payload)) {
    return null;
  }
  const eventName = typeof event.event === "string" ? event.event : event.method;
  if (eventName !== "chat" && event.type !== "chat") {
    return null;
  }
  return payload;
}

function waitForTerminalChatEvent(
  client: OpenClawGatewayEventClient,
  runId: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const addEventListener = client.addEventListener;
  if (!addEventListener || timeoutMs <= 0) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    const timer = setTimeout(() => {
      unsubscribe?.();
      resolve(null);
    }, timeoutMs);
    unsubscribe = addEventListener((event) => {
      const payload = normalizeChatEvent(event);
      if (!payload || payload.runId !== runId) {
        return;
      }
      const state = typeof payload.state === "string" ? payload.state : "";
      if (state !== "final" && state !== "aborted" && state !== "error") {
        return;
      }
      clearTimeout(timer);
      unsubscribe?.();
      resolve(payload);
    });
  });
}

function eventToResult(event: Record<string, unknown> | null): OuiAdapterExecutionResult {
  if (!event) {
    return {
      status: "blocked",
      summary: "OpenClaw accepted the run, but no terminal chat event was observed.",
      resultJson: { mode: "accepted_without_terminal_event" },
    };
  }
  const state = typeof event.state === "string" ? event.state : "";
  if (state === "aborted") {
    return { status: "cancelled", summary: "OpenClaw run was aborted.", resultJson: event };
  }
  if (state === "error") {
    return {
      status: "failed",
      summary: "OpenClaw run failed.",
      resultJson: event,
      error: typeof event.error === "string" ? event.error : "OpenClaw chat error",
    };
  }
  return { status: "succeeded", summary: "OpenClaw run completed.", resultJson: event };
}

export function createOpenClawAdapter(options: OpenClawAdapterOptions): OuiAdapterModule {
  const snapshot = buildOpenClawCompatSnapshot(options.hello);
  const adapter: OuiAdapterModule = {
    id: options.id ?? "openclaw-local",
    kind: "openclaw",
    label: options.label ?? "OpenClaw",
    capabilities: snapshot.adapterCapabilities,
    async testConnection() {
      if (snapshot.capabilities.chatSend.state === "missing") {
        return {
          ok: false,
          status: "unavailable",
          message: "Connected Gateway does not support chat.send.",
          details: { compat: snapshot },
        };
      }
      return {
        ok: true,
        status: snapshot.methodsKnown ? "connected" : "degraded",
        message: snapshot.methodsKnown
          ? "OpenClaw compatibility features advertised."
          : "OpenClaw connected without feature advertisement; execution remains capability-gated.",
        details: { compat: snapshot },
      };
    },
    async listModels(): Promise<OuiModelRef[]> {
      const result = await options.client.request("models.list", { view: "configured" });
      if (!isRecord(result) || !Array.isArray(result.models)) {
        return [];
      }
      return result.models.filter(isRecord).map((model) => ({
        id: typeof model.id === "string" ? model.id : JSON.stringify(model),
        label: typeof model.label === "string" ? model.label : undefined,
        provider: typeof model.provider === "string" ? model.provider : undefined,
        metadata: model,
      }));
    },
    async execute(ctx: OuiAdapterExecutionContext): Promise<OuiAdapterExecutionResult> {
      const input = extractRunInput(ctx.run.input);
      await ctx.log("info", `Dispatching OpenClaw run ${ctx.run.id}.`);
      const terminalEvent = waitForTerminalChatEvent(
        options.client,
        ctx.run.id,
        options.terminalEventTimeoutMs ?? 0,
      );
      await options.client.request("chat.send", {
        sessionKey: input.sessionKey,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        message: input.message,
        deliver: false,
        idempotencyKey: ctx.run.id,
      });
      const event = await terminalEvent;
      return eventToResult(event);
    },
    async cancel(ctx) {
      await options.client.request("chat.abort", {
        sessionKey: ctx.run.sessionKey ?? ctx.run.input.sessionKey,
        runId: ctx.run.id,
      });
    },
  };
  return adapter;
}

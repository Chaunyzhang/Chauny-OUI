import type { GatewayHelloOk } from "../../ui/gateway.ts";
import type { OuiAdapterCapabilities, OuiCapabilityState } from "../shared/types.ts";

export type OpenClawCompatCapabilityKey =
  | "status"
  | "chatHistory"
  | "chatSend"
  | "chatAbort"
  | "sessionsList"
  | "sessionsPatch"
  | "modelsList"
  | "agentsList"
  | "manualUsageQuery"
  | "nodeList"
  | "devicePairList"
  | "chatEvents";

export type OpenClawCompatCapability = {
  key: OpenClawCompatCapabilityKey;
  state: OuiCapabilityState | "manual";
  methods: string[];
  events?: string[];
  manualOnly?: boolean;
};

export type OpenClawCompatSnapshot = {
  protocol?: number;
  serverVersion?: string;
  connId?: string;
  methodsKnown: boolean;
  eventsKnown: boolean;
  capabilities: Record<OpenClawCompatCapabilityKey, OpenClawCompatCapability>;
  adapterCapabilities: OuiAdapterCapabilities;
};

const CAPABILITY_METHODS: Record<Exclude<OpenClawCompatCapabilityKey, "chatEvents">, string[]> = {
  status: ["status", "health"],
  chatHistory: ["chat.history"],
  chatSend: ["chat.send"],
  chatAbort: ["chat.abort"],
  sessionsList: ["sessions.list"],
  sessionsPatch: ["sessions.patch"],
  modelsList: ["models.list"],
  agentsList: ["agents.list"],
  manualUsageQuery: ["sessions.usage", "usage.cost"],
  nodeList: ["node.list"],
  devicePairList: ["device.pair.list"],
};

const CAPABILITY_EVENTS: Record<Extract<OpenClawCompatCapabilityKey, "chatEvents">, string[]> = {
  chatEvents: ["chat"],
};

function methodState(
  methods: ReadonlySet<string> | null,
  candidates: string[],
  requireAll = false,
): OuiCapabilityState {
  if (!methods) {
    return "unknown";
  }
  const hits = candidates.filter((candidate) => methods.has(candidate)).length;
  if (requireAll) {
    return hits === candidates.length ? "available" : "missing";
  }
  return hits > 0 ? "available" : "missing";
}

function eventState(events: ReadonlySet<string> | null, candidates: string[]): OuiCapabilityState {
  if (!events) {
    return "unknown";
  }
  return candidates.some((candidate) => events.has(candidate)) ? "available" : "missing";
}

function asCapabilityState(state: OuiCapabilityState | "manual"): OuiCapabilityState {
  return state === "manual" ? "available" : state;
}

export function buildOpenClawCompatSnapshot(hello?: GatewayHelloOk | null): OpenClawCompatSnapshot {
  const methods = hello?.features?.methods ? new Set(hello.features.methods) : null;
  const events = hello?.features?.events ? new Set(hello.features.events) : null;
  const capabilities = {} as Record<OpenClawCompatCapabilityKey, OpenClawCompatCapability>;

  for (const [key, candidates] of Object.entries(CAPABILITY_METHODS)) {
    const capabilityKey = key as Exclude<OpenClawCompatCapabilityKey, "chatEvents">;
    const manualOnly =
      capabilityKey === "manualUsageQuery" ||
      capabilityKey === "nodeList" ||
      capabilityKey === "devicePairList";
    const requireAll = capabilityKey === "manualUsageQuery";
    const state = methodState(methods, candidates, requireAll);
    capabilities[capabilityKey] = {
      key: capabilityKey,
      state: manualOnly && state === "available" ? "manual" : state,
      methods: candidates,
      manualOnly,
    };
  }

  capabilities.chatEvents = {
    key: "chatEvents",
    state: eventState(events, CAPABILITY_EVENTS.chatEvents),
    methods: [],
    events: CAPABILITY_EVENTS.chatEvents,
  };

  return {
    protocol: hello?.protocol,
    serverVersion: hello?.server?.version,
    connId: hello?.server?.connId,
    methodsKnown: methods !== null,
    eventsKnown: events !== null,
    capabilities,
    adapterCapabilities: {
      execute: asCapabilityState(capabilities.chatSend.state),
      cancel: asCapabilityState(capabilities.chatAbort.state),
      streamEvents: asCapabilityState(capabilities.chatEvents.state),
      listModels: asCapabilityState(capabilities.modelsList.state),
      listAgents: asCapabilityState(capabilities.agentsList.state),
      listSkills: "unknown",
      usageQuery: capabilities.manualUsageQuery.state,
      localRuntime: "available",
      externalExecution: false,
    },
  };
}

export function shouldAutoProbeOpenClawCapability(key: OpenClawCompatCapabilityKey): boolean {
  return key !== "manualUsageQuery" && key !== "nodeList" && key !== "devicePairList";
}

export function describeOpenClawCompatGap(
  snapshot: OpenClawCompatSnapshot,
  key: OpenClawCompatCapabilityKey,
): string | null {
  const capability = snapshot.capabilities[key];
  if (capability.state === "available" || capability.state === "manual") {
    return null;
  }
  if (capability.state === "unknown") {
    return `OpenClaw Gateway did not advertise ${key}; keep this path capability-gated.`;
  }
  return `OpenClaw Gateway is missing ${key}.`;
}

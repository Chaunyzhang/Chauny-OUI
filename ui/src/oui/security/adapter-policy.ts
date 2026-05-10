import type { OuiAdapterKind, OuiAdapterModule, OuiFeatureFlags } from "../shared/types.ts";

export type OuiAdapterExecutionPolicy = {
  allowed: boolean;
  code:
    | "allowed"
    | "server_disabled"
    | "run_queue_disabled"
    | "openclaw_disabled"
    | "external_disabled"
    | "adapter_not_allowlisted"
    | "process_disabled"
    | "http_disabled";
  message: string;
};

export type OuiAdapterExecutionPolicyInput = {
  adapter: OuiAdapterModule;
  flags: OuiFeatureFlags;
  allowlist?: ReadonlySet<string> | string[];
};

function hasAllowlistEntry(
  allowlist: ReadonlySet<string> | string[] | undefined,
  adapterId: string,
) {
  if (!allowlist) {
    return false;
  }
  return Array.isArray(allowlist) ? allowlist.includes(adapterId) : allowlist.has(adapterId);
}

function isExternalKind(kind: OuiAdapterKind): boolean {
  return kind !== "openclaw" && kind !== "fake";
}

function deny(code: OuiAdapterExecutionPolicy["code"], message: string): OuiAdapterExecutionPolicy {
  return { allowed: false, code, message };
}

export function evaluateAdapterExecutionPolicy(
  input: OuiAdapterExecutionPolicyInput,
): OuiAdapterExecutionPolicy {
  const { adapter, flags } = input;
  if (!flags.ouiServerEnabled) {
    return deny("server_disabled", "OUI server is disabled.");
  }
  if (!flags.ouiRunQueueEnabled) {
    return deny("run_queue_disabled", "OUI run queue is disabled.");
  }
  if (adapter.kind === "openclaw" && !flags.ouiOpenClawAdapterRunsEnabled) {
    return deny("openclaw_disabled", "OpenClaw adapter runs are disabled.");
  }
  if (isExternalKind(adapter.kind) && !flags.ouiExternalAdaptersEnabled) {
    return deny("external_disabled", "External adapter execution is disabled.");
  }
  if (isExternalKind(adapter.kind) && !hasAllowlistEntry(input.allowlist, adapter.id)) {
    return deny("adapter_not_allowlisted", "Adapter is not on the OUI execution allowlist.");
  }
  if (adapter.kind === "process" && !flags.ouiProcessAdapterExecutionEnabled) {
    return deny("process_disabled", "Process adapter execution is disabled.");
  }
  if (adapter.kind === "http" && !flags.ouiHttpAdapterExecutionEnabled) {
    return deny("http_disabled", "HTTP adapter execution is disabled.");
  }
  return { allowed: true, code: "allowed", message: "Adapter execution allowed." };
}

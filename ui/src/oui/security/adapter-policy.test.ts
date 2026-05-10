import { describe, expect, it } from "vitest";
import { createDefaultOuiFeatureFlags } from "../shared/feature-flags.ts";
import type { OuiAdapterKind, OuiAdapterModule } from "../shared/types.ts";
import { evaluateAdapterExecutionPolicy } from "./adapter-policy.ts";

function adapter(kind: OuiAdapterKind, id = `${kind}-adapter`): OuiAdapterModule {
  return {
    id,
    kind,
    label: id,
    capabilities: {
      execute: "available",
      cancel: "missing",
      streamEvents: "missing",
      listModels: "missing",
      listAgents: "missing",
      listSkills: "missing",
      usageQuery: "missing",
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

describe("adapter execution policy", () => {
  it("allows OpenClaw runs in the P0 default but blocks them when the flag is off", () => {
    expect(
      evaluateAdapterExecutionPolicy({
        adapter: adapter("openclaw"),
        flags: createDefaultOuiFeatureFlags(),
      }).allowed,
    ).toBe(true);

    expect(
      evaluateAdapterExecutionPolicy({
        adapter: adapter("openclaw"),
        flags: createDefaultOuiFeatureFlags({ ouiOpenClawAdapterRunsEnabled: false }),
      }).code,
    ).toBe("openclaw_disabled");
  });

  it("keeps external adapters blocked until both external and adapter-specific flags allow them", () => {
    const processAdapter = adapter("process", "process-local");
    expect(
      evaluateAdapterExecutionPolicy({
        adapter: processAdapter,
        flags: createDefaultOuiFeatureFlags(),
        allowlist: ["process-local"],
      }).code,
    ).toBe("external_disabled");

    expect(
      evaluateAdapterExecutionPolicy({
        adapter: processAdapter,
        flags: createDefaultOuiFeatureFlags({ ouiExternalAdaptersEnabled: true }),
        allowlist: ["process-local"],
      }).code,
    ).toBe("process_disabled");

    expect(
      evaluateAdapterExecutionPolicy({
        adapter: processAdapter,
        flags: createDefaultOuiFeatureFlags({
          ouiExternalAdaptersEnabled: true,
          ouiProcessAdapterExecutionEnabled: true,
        }),
        allowlist: ["process-local"],
      }).allowed,
    ).toBe(true);
  });
});

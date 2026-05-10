import { describe, expect, it } from "vitest";
import type { OuiAdapterKind, OuiAdapterModule } from "../shared/types.ts";
import { createOuiAdapterRegistry } from "./registry.ts";

function createAdapter(id: string, kind: OuiAdapterKind = "fake"): OuiAdapterModule {
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

describe("OuiAdapterRegistry", () => {
  it("registers builtins as enabled and refreshes models only on manual calls", async () => {
    const adapter = createAdapter("openclaw-local", "openclaw");
    adapter.listModels = async (ctx) => {
      expect(ctx.manual).toBe(true);
      return [{ id: "gpt-5.5", provider: "openai" }];
    };
    const registry = createOuiAdapterRegistry([adapter]);

    expect(registry.listEnabled().map((item) => item.id)).toEqual(["openclaw-local"]);
    await expect(registry.refreshModels("openclaw-local")).resolves.toEqual([
      { id: "gpt-5.5", provider: "openai" },
    ]);
  });

  it("keeps non-allowlisted external adapters disabled", async () => {
    const registry = createOuiAdapterRegistry();
    await registry.register(createAdapter("process-local", "process"), {
      kind: "external",
      allowlisted: false,
      packageName: "oui-process",
    });

    expect(registry.list()).toHaveLength(1);
    expect(registry.listEnabled()).toEqual([]);
    await expect(registry.setEnabled("process-local", true)).rejects.toThrow(/not allowlisted/);
  });

  it("restores builtin fallback when an external override is unregistered", async () => {
    const builtin = createAdapter("openclaw-local", "openclaw");
    const registry = createOuiAdapterRegistry([builtin]);
    const override = createAdapter("openclaw-local", "openclaw");
    override.label = "Override";

    await registry.register(override, { kind: "external", allowlisted: true });
    expect(registry.require("openclaw-local").label).toBe("Override");

    await registry.unregister("openclaw-local");
    expect(registry.require("openclaw-local")).toBe(builtin);
  });
});

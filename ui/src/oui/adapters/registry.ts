import type { OuiAdapterModule, OuiAdapterSource, OuiModelRef } from "../shared/types.ts";

export type OuiRegisteredAdapter = {
  module: OuiAdapterModule;
  source: OuiAdapterSource;
  enabled: boolean;
};

export class OuiAdapterRegistry {
  private readonly adaptersById = new Map<string, OuiRegisteredAdapter>();
  private readonly builtinFallbacks = new Map<string, OuiRegisteredAdapter>();

  list(): OuiAdapterModule[] {
    return [...this.adaptersById.values()].map((entry) => entry.module);
  }

  listEnabled(): OuiAdapterModule[] {
    return [...this.adaptersById.values()]
      .filter((entry) => entry.enabled)
      .map((entry) => entry.module);
  }

  get(adapterId: string): OuiAdapterModule | null {
    return this.adaptersById.get(adapterId)?.module ?? null;
  }

  getRegistered(adapterId: string): OuiRegisteredAdapter | null {
    return this.adaptersById.get(adapterId) ?? null;
  }

  require(adapterId: string): OuiAdapterModule {
    const adapter = this.get(adapterId);
    if (!adapter) {
      throw new Error(`OUI adapter not registered: ${adapterId}`);
    }
    return adapter;
  }

  async register(module: OuiAdapterModule, source: OuiAdapterSource): Promise<void> {
    const previous = this.adaptersById.get(module.id);
    if (previous?.source.kind === "builtin" && source.kind === "external") {
      this.builtinFallbacks.set(module.id, previous);
    }
    const enabled = source.kind === "builtin" || source.allowlisted === true;
    this.adaptersById.set(module.id, { module, source, enabled });
  }

  async unregister(adapterId: string): Promise<void> {
    const fallback = this.builtinFallbacks.get(adapterId);
    if (fallback) {
      this.adaptersById.set(adapterId, fallback);
      this.builtinFallbacks.delete(adapterId);
      return;
    }
    this.adaptersById.delete(adapterId);
  }

  async setEnabled(adapterId: string, enabled: boolean): Promise<void> {
    const entry = this.adaptersById.get(adapterId);
    if (!entry) {
      throw new Error(`OUI adapter not registered: ${adapterId}`);
    }
    if (enabled && entry.source.kind === "external" && entry.source.allowlisted !== true) {
      throw new Error(`OUI external adapter is not allowlisted: ${adapterId}`);
    }
    this.adaptersById.set(adapterId, { ...entry, enabled });
  }

  async refreshModels(adapterId: string): Promise<OuiModelRef[]> {
    const adapter = this.require(adapterId);
    if (!adapter.listModels) {
      return [];
    }
    return adapter.listModels({ manual: true });
  }
}

export function createOuiAdapterRegistry(builtins: OuiAdapterModule[] = []): OuiAdapterRegistry {
  const registry = new OuiAdapterRegistry();
  for (const adapter of builtins) {
    void registry.register(adapter, { kind: "builtin", allowlisted: true });
  }
  return registry;
}

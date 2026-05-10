import type { OuiFeatureFlags } from "./types.ts";

export function createDefaultOuiFeatureFlags(
  overrides: Partial<OuiFeatureFlags> = {},
): OuiFeatureFlags {
  return {
    ouiServerEnabled: true,
    ouiRunQueueEnabled: true,
    ouiOpenClawAdapterRunsEnabled: true,
    ouiCompanyTasksEnabled: false,
    ouiExternalAdaptersEnabled: false,
    ouiProcessAdapterExecutionEnabled: false,
    ouiHttpAdapterExecutionEnabled: false,
    ouiBudgetHardStopEnabled: false,
    ouiRoutinesEnabled: false,
    ...overrides,
  };
}

export function createDisabledOuiFeatureFlags(
  overrides: Partial<OuiFeatureFlags> = {},
): OuiFeatureFlags {
  return {
    ouiServerEnabled: false,
    ouiRunQueueEnabled: false,
    ouiOpenClawAdapterRunsEnabled: false,
    ouiCompanyTasksEnabled: false,
    ouiExternalAdaptersEnabled: false,
    ouiProcessAdapterExecutionEnabled: false,
    ouiHttpAdapterExecutionEnabled: false,
    ouiBudgetHardStopEnabled: false,
    ouiRoutinesEnabled: false,
    ...overrides,
  };
}

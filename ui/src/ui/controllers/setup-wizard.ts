import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  WizardNextResult,
  WizardRunStatus,
  WizardStartResult,
  WizardStatusResult,
  WizardStep,
} from "../types.ts";

export type SetupWizardMode = "local" | "remote";

export type SetupWizardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  setupWizardBusy: boolean;
  setupWizardSessionId: string | null;
  setupWizardStep: WizardStep | null;
  setupWizardStatus: WizardRunStatus | "idle";
  setupWizardError: string | null;
};

function normalizeWizardError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function applyWizardResult(
  state: SetupWizardState,
  result: WizardNextResult,
  sessionId = state.setupWizardSessionId,
) {
  state.setupWizardSessionId = result.done ? null : sessionId;
  state.setupWizardStep = result.done ? null : (result.step ?? null);
  state.setupWizardStatus = result.done ? (result.status ?? "done") : (result.status ?? "running");
  state.setupWizardError = result.error ?? null;
}

export async function startSetupWizard(
  state: SetupWizardState,
  mode?: SetupWizardMode,
): Promise<boolean> {
  if (!state.client || !state.connected || state.setupWizardBusy) {
    return false;
  }
  state.setupWizardBusy = true;
  state.setupWizardError = null;
  try {
    const result = await state.client.request<WizardStartResult>("wizard.start", {
      ...(mode ? { mode } : {}),
    });
    applyWizardResult(state, result, result.sessionId);
    return true;
  } catch (err) {
    state.setupWizardError = normalizeWizardError(err);
    state.setupWizardStatus = "error";
    return false;
  } finally {
    state.setupWizardBusy = false;
  }
}

export async function submitSetupWizardAnswer(
  state: SetupWizardState,
  value: unknown,
): Promise<boolean> {
  const sessionId = state.setupWizardSessionId;
  const stepId = state.setupWizardStep?.id;
  if (!state.client || !state.connected || !sessionId || !stepId || state.setupWizardBusy) {
    return false;
  }
  state.setupWizardBusy = true;
  state.setupWizardError = null;
  try {
    const result = await state.client.request<WizardNextResult>("wizard.next", {
      sessionId,
      answer: { stepId, value },
    });
    applyWizardResult(state, result, sessionId);
    return true;
  } catch (err) {
    state.setupWizardError = normalizeWizardError(err);
    return false;
  } finally {
    state.setupWizardBusy = false;
  }
}

export async function cancelSetupWizard(state: SetupWizardState): Promise<boolean> {
  const sessionId = state.setupWizardSessionId;
  if (!state.client || !state.connected || !sessionId || state.setupWizardBusy) {
    return false;
  }
  state.setupWizardBusy = true;
  state.setupWizardError = null;
  try {
    const result = await state.client.request<WizardStatusResult>("wizard.cancel", { sessionId });
    state.setupWizardSessionId = null;
    state.setupWizardStep = null;
    state.setupWizardStatus = result.status;
    state.setupWizardError = result.error ?? null;
    return true;
  } catch (err) {
    state.setupWizardError = normalizeWizardError(err);
    return false;
  } finally {
    state.setupWizardBusy = false;
  }
}

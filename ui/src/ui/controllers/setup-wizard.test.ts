import { describe, expect, it, vi } from "vitest";
import {
  cancelSetupWizard,
  startSetupWizard,
  submitSetupWizardAnswer,
  type SetupWizardState,
} from "./setup-wizard.ts";

function createState(request: ReturnType<typeof vi.fn>): SetupWizardState {
  return {
    client: { request } as unknown as SetupWizardState["client"],
    connected: true,
    setupWizardBusy: false,
    setupWizardSessionId: null,
    setupWizardStep: null,
    setupWizardStatus: "idle",
    setupWizardError: null,
  };
}

describe("setup wizard controller", () => {
  it("starts a gateway wizard session", async () => {
    const request = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      done: false,
      status: "running",
      step: { id: "step-1", type: "select", message: "Setup mode" },
    });
    const state = createState(request);

    await expect(startSetupWizard(state, "local")).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith("wizard.start", { mode: "local" });
    expect(state.setupWizardSessionId).toBe("session-1");
    expect(state.setupWizardStep?.id).toBe("step-1");
    expect(state.setupWizardStatus).toBe("running");
  });

  it("submits the current step answer", async () => {
    const request = vi.fn().mockResolvedValue({ done: true, status: "done" });
    const state = createState(request);
    state.setupWizardSessionId = "session-1";
    state.setupWizardStep = { id: "step-1", type: "confirm", message: "Continue?" };
    state.setupWizardStatus = "running";

    await expect(submitSetupWizardAnswer(state, true)).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith("wizard.next", {
      sessionId: "session-1",
      answer: { stepId: "step-1", value: true },
    });
    expect(state.setupWizardSessionId).toBeNull();
    expect(state.setupWizardStatus).toBe("done");
  });

  it("cancels a running session", async () => {
    const request = vi.fn().mockResolvedValue({ status: "cancelled", error: "cancelled" });
    const state = createState(request);
    state.setupWizardSessionId = "session-1";
    state.setupWizardStep = { id: "step-1", type: "text", message: "API key" };
    state.setupWizardStatus = "running";

    await expect(cancelSetupWizard(state)).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith("wizard.cancel", { sessionId: "session-1" });
    expect(state.setupWizardSessionId).toBeNull();
    expect(state.setupWizardStep).toBeNull();
    expect(state.setupWizardStatus).toBe("cancelled");
  });
});

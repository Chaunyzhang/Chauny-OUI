/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSetupWizard, type SetupWizardProps } from "./setup-wizard.ts";

function createProps(overrides: Partial<SetupWizardProps> = {}): SetupWizardProps {
  return {
    connected: true,
    busy: false,
    sessionId: null,
    status: "idle",
    error: null,
    step: null,
    config: {
      agents: { defaults: { model: { primary: "openai-codex/gpt-5.5" } } },
      models: { providers: { "openai-codex": {}, minimax: {} } },
    },
    channelsSnapshot: {
      ts: Date.now(),
      channelOrder: ["telegram", "discord"],
      channelLabels: { telegram: "Telegram", discord: "Discord" },
      channels: {
        telegram: { configured: true },
        discord: { configured: false },
      },
      channelAccounts: {},
      channelDefaultAccountId: {},
    },
    modelAuthStatus: {
      ts: Date.now(),
      providers: [
        {
          provider: "openai-codex",
          displayName: "OpenAI Codex",
          status: "ok",
          profiles: [{ profileId: "default", type: "oauth", status: "ok" }],
        },
      ],
    },
    configReady: true,
    setupModelProviderId: "minimax",
    setupModelPlanId: "minimax-cn-api",
    setupModelApiKey: "",
    setupModelSaving: false,
    setupModelMessage: null,
    onSetupModelProviderChange: vi.fn(),
    onSetupModelPlanChange: vi.fn(),
    onSetupModelApiKeyChange: vi.fn(),
    onSetupModelApply: vi.fn(),
    onStart: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}

function createContainer(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

describe("renderSetupWizard", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("renders current model and channel configuration summary", () => {
    const container = createContainer();

    render(renderSetupWizard(createProps()), container);

    expect(container.textContent).toContain("openai-codex/gpt-5.5");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("1 / 2");
  });

  it("starts local and remote wizard modes", () => {
    const onStart = vi.fn();
    const container = createContainer();

    render(renderSetupWizard(createProps({ onStart })), container);

    container.querySelector("details")!.open = true;
    const buttons = Array.from(container.querySelectorAll("button"));
    buttons.find((button) => button.textContent?.includes("local"))?.click();
    expect(onStart).toHaveBeenCalledWith("local");

    buttons.find((button) => button.textContent?.includes("remote"))?.click();
    expect(onStart).toHaveBeenCalledWith("remote");
  });

  it("submits quick model setup selections and api key", () => {
    const onSetupModelProviderChange = vi.fn();
    const onSetupModelPlanChange = vi.fn();
    const onSetupModelApiKeyChange = vi.fn();
    const onSetupModelApply = vi.fn();
    const container = createContainer();

    render(
      renderSetupWizard(
        createProps({
          setupModelApiKey: "sk-test",
          onSetupModelProviderChange,
          onSetupModelPlanChange,
          onSetupModelApiKeyChange,
          onSetupModelApply,
        }),
      ),
      container,
    );

    const selects = container.querySelectorAll<HTMLElement & { value: string }>(
      ".setup-field oui-select",
    );
    selects[0]!.value = "qwen";
    selects[0]!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetupModelProviderChange).toHaveBeenCalledWith("qwen");

    selects[1]!.value = "minimax-global-api";
    selects[1]!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetupModelPlanChange).toHaveBeenCalledWith("minimax-global-api");

    const input = container.querySelector<HTMLInputElement>(".setup-field--key input")!;
    input.value = "next-key";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(onSetupModelApiKeyChange).toHaveBeenCalledWith("next-key");

    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("default"))
      ?.click();
    expect(onSetupModelApply).toHaveBeenCalled();
  });

  it("keeps quick model setup free of explanatory microcopy", () => {
    const container = createContainer();

    render(renderSetupWizard(createProps()), container);

    expect(container.textContent).not.toContain("One click config");
    expect(container.textContent).not.toContain("MiniMax M2.7 with");
    expect(container.textContent).not.toContain("Hosted MiniMax API");
    expect(container.textContent).not.toContain("Default model after save");
    expect(container.textContent).not.toContain("MINIMAX_API_KEY");
    expect(container.querySelector<HTMLInputElement>(".setup-field--key input")?.placeholder).toBe(
      "",
    );
    expect(container.querySelector(".setup-field select")).toBeNull();
  });

  it("submits select step option values", () => {
    const onSubmit = vi.fn();
    const container = createContainer();

    render(
      renderSetupWizard(
        createProps({
          sessionId: "session-1",
          status: "running",
          step: {
            id: "step-1",
            type: "select",
            message: "Setup mode",
            options: [
              { value: "quickstart", label: "QuickStart" },
              { value: "advanced", label: "Manual" },
            ],
          },
          onSubmit,
        }),
      ),
      container,
    );

    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Manual"))
      ?.click();

    expect(onSubmit).toHaveBeenCalledWith("advanced");
  });

  it("submits text step values", () => {
    const onSubmit = vi.fn();
    const container = createContainer();

    render(
      renderSetupWizard(
        createProps({
          sessionId: "session-1",
          status: "running",
          step: { id: "step-1", type: "text", message: "API key", sensitive: true },
          onSubmit,
        }),
      ),
      container,
    );

    const form = container.querySelector<HTMLFormElement>(".setup-step__form");
    expect(form).toBeTruthy();
    form!.querySelector<HTMLInputElement>('input[name="value"]')!.value = "secret";
    form!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith("secret");
  });
});

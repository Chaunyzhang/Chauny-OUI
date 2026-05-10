import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderOuiCompany } from "./oui-company.ts";

const now = "2026-05-10T00:00:00.000Z";

describe("OUI company view", () => {
  it("renders company, task board, disabled employees, and run timeline", async () => {
    const onCreateTask = vi.fn();
    const onQueueRun = vi.fn();
    const task = {
      id: "task-1",
      companyId: "default",
      title: "Build P1 board",
      description: "Visible task flow",
      status: "ready" as const,
      reviewState: "requested" as const,
      assignedAgentId: "openclaw-alpha",
      createdBy: null,
      priority: 0,
      createdAt: now,
      updatedAt: now,
    };
    const container = document.createElement("div");

    render(
      renderOuiCompany({
        loading: false,
        busy: false,
        apiAvailable: true,
        error: null,
        message: null,
        company: { id: "default", name: "OUI Company", defaultLeaderAgentId: "openclaw-alpha" },
        agents: [
          {
            id: "openclaw-alpha",
            companyId: "default",
            adapterId: "openclaw-local",
            adapterKind: "openclaw",
            label: "Alpha Leader",
            roleId: null,
            reportsToAgentId: null,
            openclawAgentId: "alpha",
            modelRef: null,
            status: "active",
            isLeader: true,
            config: {},
            createdAt: now,
            updatedAt: now,
          },
        ],
        adapters: [
          {
            adapterId: "codex-local",
            kind: "codex",
            label: "Codex Employee",
            enabled: true,
            executable: false,
            reason: "External adapter execution is disabled.",
          },
        ],
        tasks: [task],
        timeline: {
          task,
          readiness: { ready: true, pendingDependencyIds: [] },
          runs: [
            {
              link: { taskId: "task-1", runId: "run-1", kind: "primary", createdAt: now },
              run: {
                id: "run-1",
                adapterId: "openclaw-local",
                adapterKind: "openclaw",
                agentId: "openclaw-alpha",
                sessionKey: "main",
                status: "running",
                input: {},
                attempts: 0,
                maxAttempts: 1,
                queuedAt: now,
                updatedAt: now,
                result: { usage: { inputTokens: 3 } },
              },
              logs: [
                {
                  id: "log-1",
                  runId: "run-1",
                  seq: 1,
                  level: "info",
                  message: "started",
                  createdAt: now,
                },
              ],
              costEvents: [],
            },
          ],
        },
        selectedTaskId: "task-1",
        draftTitle: "New task",
        draftDescription: "",
        draftAgentId: "",
        onRefresh: vi.fn(),
        onDraftTitleChange: vi.fn(),
        onDraftDescriptionChange: vi.fn(),
        onDraftAgentChange: vi.fn(),
        onCreateTask,
        onSelectTask: vi.fn(),
        onAssignTask: vi.fn(),
        onQueueRun,
        onReviewTransition: vi.fn(),
        onOpenParallelChat: vi.fn(),
      }),
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".oui-company__agent-card--leader")?.textContent).toContain(
      "Alpha Leader",
    );
    expect(container.textContent).toContain("Codex Employee");
    expect(container.textContent).toContain("External adapter execution is disabled.");
    expect(container.textContent).toContain("Build P1 board");
    expect(container.textContent).toContain("run-1");
    expect(container.textContent).toContain("started");

    container.querySelector<HTMLButtonElement>(".oui-company__create-button")?.click();
    expect(onCreateTask).toHaveBeenCalledTimes(1);

    const runButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Run"),
    );
    runButton?.click();
    expect(onQueueRun).toHaveBeenCalledWith("task-1");
  });
});

import type { OuiAdapterRegistry } from "../adapters/registry.ts";
import { evaluateAdapterExecutionPolicy } from "../security/adapter-policy.ts";
import type {
  OuiCostEventRecord,
  OuiEmployeeAdapterPreview,
  OuiProductStore,
  OuiQueueTaskRunInput,
  OuiQueuedTaskRunResult,
  OuiTaskTimeline,
  OuiTaskTimelineRun,
} from "../shared/product-types.ts";
import type { OuiFeatureFlags, OuiJsonObject, OuiRunRecord, OuiRunStore } from "../shared/types.ts";

export type OuiCompanyServiceOptions = {
  productStore: OuiProductStore;
  runStore: OuiRunStore;
  registry: OuiAdapterRegistry;
  flags: OuiFeatureFlags;
  adapterAllowlist?: ReadonlySet<string> | string[];
};

export class OuiCompanyService {
  constructor(private readonly options: OuiCompanyServiceOptions) {}

  async queueTaskRun(input: OuiQueueTaskRunInput): Promise<OuiQueuedTaskRunResult> {
    const task = await this.options.productStore.getTask(input.taskId);
    if (!task) {
      throw new Error(`OUI task not found: ${input.taskId}`);
    }

    const readiness = await this.options.productStore.getTaskReadiness(input.taskId);
    if (!readiness.ready) {
      const blocked = await this.options.productStore.updateTaskStatus(
        input.taskId,
        "blocked",
        input.now,
      );
      return { status: "blocked", task: blocked, readiness };
    }

    const company = await this.options.productStore.getCompany(task.companyId);
    const agentId = task.assignedAgentId ?? company?.defaultLeaderAgentId ?? null;
    if (!agentId) {
      const blocked = await this.options.productStore.updateTaskStatus(
        input.taskId,
        "blocked",
        input.now,
      );
      return {
        status: "blocked",
        task: blocked,
        readiness: { ready: false, pendingDependencyIds: ["assigned-agent"] },
      };
    }

    const agent = await this.options.productStore.getAgent(agentId);
    if (!agent || agent.status !== "active") {
      const blocked = await this.options.productStore.updateTaskStatus(
        input.taskId,
        "blocked",
        input.now,
      );
      return {
        status: "blocked",
        task: blocked,
        readiness: { ready: false, pendingDependencyIds: [`agent:${agentId}`] },
      };
    }

    const adapter = this.options.registry.require(input.adapterId ?? agent.adapterId);
    const policy = evaluateAdapterExecutionPolicy({
      adapter,
      flags: this.options.flags,
      allowlist: this.options.adapterAllowlist,
    });
    if (!policy.allowed) {
      const blocked = await this.options.productStore.updateTaskStatus(
        input.taskId,
        "blocked",
        input.now,
      );
      return {
        status: "blocked",
        task: blocked,
        readiness: { ready: false, pendingDependencyIds: [policy.code] },
      };
    }

    const run = await this.options.runStore.enqueueRun({
      id: input.runId,
      adapterId: adapter.id,
      adapterKind: input.adapterKind ?? agent.adapterKind,
      agentId: agent.id,
      sessionKey: input.sessionKey ?? null,
      input: this.buildRunInput(task.title, task.description, input),
      maxAttempts: input.maxAttempts,
      now: input.now,
    });
    await this.options.productStore.attachRunToTask(task.id, run.id, "primary", input.now);
    const runningTask = await this.options.productStore.updateTaskStatus(
      task.id,
      "running",
      input.now,
    );
    return { status: "queued", task: runningTask, run, readiness };
  }

  async recordRunCostFromResult(
    taskId: string,
    run: OuiRunRecord,
  ): Promise<OuiCostEventRecord | null> {
    const cost = this.extractJsonObject(run.result?.cost);
    const usage = this.extractJsonObject(run.result?.usage) ?? {};
    if (!cost && Object.keys(usage).length === 0) {
      return null;
    }
    const amountMicros = this.extractAmountMicros(cost);
    const currency = typeof cost?.currency === "string" ? cost.currency : null;
    return this.options.productStore.recordCostEvent({
      runId: run.id,
      taskId,
      agentId: run.agentId ?? null,
      amountMicros,
      currency,
      usage,
      source: "run_result",
    });
  }

  async getTaskTimeline(taskId: string): Promise<OuiTaskTimeline> {
    const task = await this.options.productStore.getTask(taskId);
    if (!task) {
      throw new Error(`OUI task not found: ${taskId}`);
    }
    const readiness = await this.options.productStore.getTaskReadiness(taskId);
    const links = await this.options.productStore.listTaskRunLinks(taskId);
    const runs: OuiTaskTimelineRun[] = [];
    for (const link of links) {
      const run = await this.options.runStore.getRun(link.runId);
      runs.push({
        link,
        run,
        logs: run ? await this.options.runStore.listLogs(run.id) : [],
        costEvents: run ? await this.options.productStore.listCostEventsForRun(run.id) : [],
      });
    }
    return { task, readiness, runs };
  }

  listEmployeeAdapterPreviews(): OuiEmployeeAdapterPreview[] {
    return this.options.registry.list().map((adapter) => {
      const policy = evaluateAdapterExecutionPolicy({
        adapter,
        flags: this.options.flags,
        allowlist: this.options.adapterAllowlist,
      });
      return {
        adapterId: adapter.id,
        kind: adapter.kind,
        label: adapter.label,
        enabled: this.options.registry.getRegistered(adapter.id)?.enabled ?? false,
        executable: policy.allowed,
        reason: policy.allowed ? undefined : policy.message,
      };
    });
  }

  private buildRunInput(
    title: string,
    description: string | null | undefined,
    input: OuiQueueTaskRunInput,
  ): OuiJsonObject {
    return {
      sessionKey: input.sessionKey ?? "main",
      message: input.message ?? [title, description].filter(Boolean).join("\n\n"),
      taskId: input.taskId,
    };
  }

  private extractJsonObject(value: unknown): OuiJsonObject | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as OuiJsonObject)
      : null;
  }

  private extractAmountMicros(cost: OuiJsonObject | null): number | null {
    if (!cost) {
      return null;
    }
    if (typeof cost.amountMicros === "number") {
      return cost.amountMicros;
    }
    if (typeof cost.usd === "number") {
      return Math.round(cost.usd * 1_000_000);
    }
    if (typeof cost.amount === "number" && cost.currency === "USD") {
      return Math.round(cost.amount * 1_000_000);
    }
    return null;
  }
}

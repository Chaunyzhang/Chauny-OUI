import type { OuiAdapterRegistry } from "../adapters/registry.ts";
import { evaluateAdapterExecutionPolicy } from "../security/adapter-policy.ts";
import type {
  OuiAdapterExecutionResult,
  OuiFeatureFlags,
  OuiRunRecord,
  OuiRunStore,
} from "../shared/types.ts";

export type OuiRunDispatcherOptions = {
  store: OuiRunStore;
  registry: OuiAdapterRegistry;
  flags: OuiFeatureFlags;
  workerId: string;
  leaseMs?: number;
  adapterAllowlist?: ReadonlySet<string> | string[];
};

export type OuiDispatchResult =
  | { status: "idle" }
  | { status: "finished"; run: OuiRunRecord }
  | { status: "blocked"; run: OuiRunRecord }
  | { status: "lost"; runId: string };

export class OuiRunDispatcher {
  private readonly leaseMs: number;

  constructor(private readonly options: OuiRunDispatcherOptions) {
    this.leaseMs = options.leaseMs ?? 30_000;
  }

  async dispatchOnce(now = new Date()): Promise<OuiDispatchResult> {
    const claimed = await this.options.store.claimNextRun({
      workerId: this.options.workerId,
      leaseMs: this.leaseMs,
      now,
    });
    if (!claimed) {
      return { status: "idle" };
    }

    const started = await this.options.store.startLeasedRun({
      runId: claimed.run.id,
      workerId: this.options.workerId,
      leaseToken: claimed.leaseToken,
      now,
    });
    if (!started) {
      return { status: "lost", runId: claimed.run.id };
    }

    const adapter = this.options.registry.require(started.adapterId);
    const policy = evaluateAdapterExecutionPolicy({
      adapter,
      flags: this.options.flags,
      allowlist: this.options.adapterAllowlist,
    });
    if (!policy.allowed) {
      await this.options.store.appendLog({
        runId: started.id,
        level: "warn",
        message: policy.message,
        now,
      });
      const blocked = await this.options.store.finishRun({
        runId: started.id,
        workerId: this.options.workerId,
        leaseToken: claimed.leaseToken,
        status: "blocked",
        result: { policyCode: policy.code },
        error: policy.message,
        now,
      });
      return blocked ? { status: "blocked", run: blocked } : { status: "lost", runId: started.id };
    }

    try {
      const result = await adapter.execute({
        run: started,
        log: async (level, message) => {
          await this.options.store.appendLog({ runId: started.id, level, message });
        },
      });
      const finished = await this.finishResult(started, claimed.leaseToken, result);
      return finished
        ? { status: "finished", run: finished }
        : { status: "lost", runId: started.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      await this.options.store.appendLog({ runId: started.id, level: "error", message });
      const failed = await this.options.store.finishRun({
        runId: started.id,
        workerId: this.options.workerId,
        leaseToken: claimed.leaseToken,
        status: "failed",
        error: message,
        now: new Date(),
      });
      return failed ? { status: "finished", run: failed } : { status: "lost", runId: started.id };
    }
  }

  private finishResult(
    run: OuiRunRecord,
    leaseToken: string,
    result: OuiAdapterExecutionResult,
  ): Promise<OuiRunRecord | null> {
    return this.options.store.finishRun({
      runId: run.id,
      workerId: this.options.workerId,
      leaseToken,
      status: result.status,
      result: {
        summary: result.summary ?? null,
        resultJson: result.resultJson ?? null,
        usage: result.usage ?? null,
        cost: result.cost ?? null,
      },
      error: result.error ?? null,
      now: new Date(),
    });
  }
}

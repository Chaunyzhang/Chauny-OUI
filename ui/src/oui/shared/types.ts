export type OuiAdapterKind =
  | "openclaw"
  | "codex"
  | "claude"
  | "cursor"
  | "process"
  | "http"
  | "fake";

export type OuiRunStatus =
  | "queued"
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked";

export type OuiTerminalRunStatus = Extract<
  OuiRunStatus,
  "succeeded" | "failed" | "cancelled" | "timed_out" | "blocked"
>;

export type OuiLogLevel = "debug" | "info" | "warn" | "error";

export type OuiJsonObject = Record<string, unknown>;

export type OuiCapabilityState = "available" | "missing" | "unknown";

export type OuiAdapterCapabilityValue = boolean | OuiCapabilityState | "manual" | "unsupported";

export type OuiAdapterCapabilities = {
  execute: OuiCapabilityState;
  cancel: OuiCapabilityState;
  streamEvents: OuiCapabilityState;
  listModels: OuiCapabilityState;
  listAgents: OuiCapabilityState;
  listSkills: OuiCapabilityState;
  usageQuery: OuiCapabilityState | "manual";
  localRuntime: OuiCapabilityState;
  externalExecution: boolean;
};

export type OuiCredentialRef = {
  id: string;
  provider: "os_keychain" | "encrypted_file" | "env" | "external";
  label: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
};

export type OuiAdapterTestContext = {
  now?: Date;
};

export type OuiAdapterTestResult = {
  ok: boolean;
  status: "connected" | "degraded" | "unavailable";
  message?: string;
  details?: OuiJsonObject;
};

export type OuiAdapterListContext = {
  manual: boolean;
};

export type OuiAdapterDetectContext = {
  manual: boolean;
};

export type OuiModelRef = {
  id: string;
  label?: string;
  provider?: string;
  metadata?: OuiJsonObject;
};

export type OuiSkillRef = {
  id: string;
  label?: string;
  metadata?: OuiJsonObject;
};

export type OuiDetectedRuntime = {
  status: "available" | "missing" | "degraded";
  label?: string;
  details?: OuiJsonObject;
};

export type OuiRunRecord = {
  id: string;
  adapterId: string;
  adapterKind: OuiAdapterKind;
  agentId?: string | null;
  sessionKey?: string | null;
  status: OuiRunStatus;
  input: OuiJsonObject;
  attempts: number;
  maxAttempts: number;
  leaseOwner?: string | null;
  leaseToken?: string | null;
  leaseExpiresAt?: string | null;
  heartbeatAt?: string | null;
  queuedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt: string;
  cancelRequestedAt?: string | null;
  result?: OuiJsonObject | null;
  error?: string | null;
};

export type OuiRunLogEntry = {
  id: string;
  runId: string;
  seq: number;
  level: OuiLogLevel;
  message: string;
  createdAt: string;
};

export type OuiEnqueueRunInput = {
  id?: string;
  adapterId: string;
  adapterKind: OuiAdapterKind;
  agentId?: string | null;
  sessionKey?: string | null;
  input: OuiJsonObject;
  maxAttempts?: number;
  now?: Date;
};

export type OuiClaimRunOptions = {
  workerId: string;
  leaseMs: number;
  now?: Date;
};

export type OuiLeasedRun = {
  run: OuiRunRecord;
  leaseToken: string;
};

export type OuiHeartbeatOptions = {
  runId: string;
  workerId: string;
  leaseToken: string;
  leaseMs: number;
  now?: Date;
};

export type OuiFinishRunInput = {
  runId: string;
  workerId: string;
  leaseToken: string;
  status: OuiTerminalRunStatus;
  result?: OuiJsonObject | null;
  error?: string | null;
  now?: Date;
};

export type OuiRecoveryReport = {
  requeued: number;
  failed: number;
  inspected: number;
};

export type OuiRunStore = {
  enqueueRun(input: OuiEnqueueRunInput): Promise<OuiRunRecord>;
  getRun(runId: string): Promise<OuiRunRecord | null>;
  claimNextRun(options: OuiClaimRunOptions): Promise<OuiLeasedRun | null>;
  heartbeatRunLease(options: OuiHeartbeatOptions): Promise<OuiRunRecord | null>;
  startLeasedRun(input: {
    runId: string;
    workerId: string;
    leaseToken: string;
    now?: Date;
  }): Promise<OuiRunRecord | null>;
  finishRun(input: OuiFinishRunInput): Promise<OuiRunRecord | null>;
  requestCancel(input: { runId: string; now?: Date }): Promise<OuiRunRecord | null>;
  appendLog(input: {
    runId: string;
    level: OuiLogLevel;
    message: string;
    now?: Date;
  }): Promise<OuiRunLogEntry>;
  listLogs(runId: string): Promise<OuiRunLogEntry[]>;
  recoverExpiredLeases(input: { now?: Date }): Promise<OuiRecoveryReport>;
};

export type OuiAdapterExecutionContext = {
  run: OuiRunRecord;
  signal?: AbortSignal;
  log: (level: OuiLogLevel, message: string) => Promise<void> | void;
  setMetadata?: (metadata: OuiJsonObject) => Promise<void> | void;
};

export type OuiAdapterExecutionResult = {
  status: OuiTerminalRunStatus;
  summary?: string | null;
  resultJson?: OuiJsonObject | null;
  usage?: OuiJsonObject | null;
  cost?: OuiJsonObject | null;
  error?: string | null;
};

export type OuiAdapterCancelContext = {
  run: OuiRunRecord;
  reason?: string;
};

export type OuiAdapterConfigSchema = {
  fields: Array<{
    key: string;
    label: string;
    type: "string" | "number" | "boolean" | "credentialRef" | "select";
    required?: boolean;
    options?: Array<{ label: string; value: string }>;
  }>;
};

export type OuiAdapterSessionCodec = {
  encode(input: OuiJsonObject): OuiJsonObject;
  decode(input: OuiJsonObject): OuiJsonObject;
};

export type OuiAdapterModule = {
  id: string;
  kind: OuiAdapterKind;
  label: string;
  capabilities: OuiAdapterCapabilities;
  getConfigSchema?: () => Promise<OuiAdapterConfigSchema>;
  testConnection: (ctx: OuiAdapterTestContext) => Promise<OuiAdapterTestResult>;
  listModels?: (ctx: OuiAdapterListContext) => Promise<OuiModelRef[]>;
  listSkills?: (ctx: OuiAdapterListContext) => Promise<OuiSkillRef[]>;
  detectLocalRuntime?: (ctx: OuiAdapterDetectContext) => Promise<OuiDetectedRuntime | null>;
  execute: (ctx: OuiAdapterExecutionContext) => Promise<OuiAdapterExecutionResult>;
  cancel?: (ctx: OuiAdapterCancelContext) => Promise<void>;
  sessionCodec?: OuiAdapterSessionCodec;
};

export type OuiAdapterSource = {
  kind: "builtin" | "external";
  allowlisted?: boolean;
  packageName?: string;
};

export type OuiFeatureFlags = {
  ouiServerEnabled: boolean;
  ouiRunQueueEnabled: boolean;
  ouiOpenClawAdapterRunsEnabled: boolean;
  ouiCompanyTasksEnabled: boolean;
  ouiExternalAdaptersEnabled: boolean;
  ouiProcessAdapterExecutionEnabled: boolean;
  ouiHttpAdapterExecutionEnabled: boolean;
  ouiBudgetHardStopEnabled: boolean;
  ouiRoutinesEnabled: boolean;
};

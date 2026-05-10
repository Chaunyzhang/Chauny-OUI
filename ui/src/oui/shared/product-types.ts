import type {
  OuiAdapterKind,
  OuiEnqueueRunInput,
  OuiJsonObject,
  OuiRunLogEntry,
  OuiRunRecord,
} from "./types.ts";

export type OuiAgentStatus = "active" | "paused" | "disabled";

export type OuiTaskStatus =
  | "draft"
  | "ready"
  | "blocked"
  | "running"
  | "review"
  | "done"
  | "cancelled";

export type OuiTaskReviewState = "none" | "requested" | "changes_requested" | "approved";

export type OuiCompanyRecord = {
  id: string;
  name: string;
  defaultLeaderAgentId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OuiRoleRecord = {
  id: string;
  companyId: string;
  name: string;
  parentRoleId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OuiAgentRecord = {
  id: string;
  companyId: string;
  adapterId: string;
  adapterKind: OuiAdapterKind;
  label: string;
  roleId?: string | null;
  reportsToAgentId?: string | null;
  openclawAgentId?: string | null;
  modelRef?: string | null;
  status: OuiAgentStatus;
  isLeader: boolean;
  config: OuiJsonObject;
  createdAt: string;
  updatedAt: string;
};

export type OuiTaskRecord = {
  id: string;
  companyId: string;
  title: string;
  description?: string | null;
  status: OuiTaskStatus;
  reviewState: OuiTaskReviewState;
  assignedAgentId?: string | null;
  createdBy?: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

export type OuiTaskDependencyRecord = {
  taskId: string;
  dependsOnTaskId: string;
  createdAt: string;
};

export type OuiTaskReadiness = {
  ready: boolean;
  pendingDependencyIds: string[];
};

export type OuiTaskRunLink = {
  taskId: string;
  runId: string;
  kind: "primary" | "review" | "followup";
  createdAt: string;
};

export type OuiCostEventRecord = {
  id: string;
  runId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  amountMicros?: number | null;
  currency?: string | null;
  usage: OuiJsonObject;
  source: string;
  createdAt: string;
};

export type OuiTaskTimelineRun = {
  link: OuiTaskRunLink;
  run: OuiRunRecord | null;
  logs: OuiRunLogEntry[];
  costEvents: OuiCostEventRecord[];
};

export type OuiTaskTimeline = {
  task: OuiTaskRecord;
  readiness: OuiTaskReadiness;
  runs: OuiTaskTimelineRun[];
};

export type OuiEmployeeAdapterPreview = {
  adapterId: string;
  kind: OuiAdapterKind;
  label: string;
  enabled: boolean;
  executable: boolean;
  reason?: string;
};

export type OuiEnsureDefaultCompanyInput = {
  companyId?: string;
  name?: string;
  openclawLeader?: {
    id?: string;
    label?: string;
    openclawAgentId?: string | null;
    adapterId?: string;
    modelRef?: string | null;
  };
  now?: Date;
};

export type OuiCreateAgentInput = {
  id?: string;
  companyId: string;
  adapterId: string;
  adapterKind: OuiAdapterKind;
  label: string;
  roleId?: string | null;
  reportsToAgentId?: string | null;
  openclawAgentId?: string | null;
  modelRef?: string | null;
  status?: OuiAgentStatus;
  isLeader?: boolean;
  config?: OuiJsonObject;
  now?: Date;
};

export type OuiCreateTaskInput = {
  id?: string;
  companyId: string;
  title: string;
  description?: string | null;
  assignedAgentId?: string | null;
  createdBy?: string | null;
  priority?: number;
  now?: Date;
};

export type OuiQueueTaskRunInput = {
  taskId: string;
  runId?: string;
  message?: string;
  sessionKey?: string | null;
  adapterId?: string;
  adapterKind?: OuiAdapterKind;
  maxAttempts?: number;
  now?: Date;
};

export type OuiQueuedTaskRunResult =
  | {
      status: "queued";
      task: OuiTaskRecord;
      run: OuiRunRecord;
      readiness: OuiTaskReadiness;
    }
  | {
      status: "blocked";
      task: OuiTaskRecord;
      readiness: OuiTaskReadiness;
    };

export type OuiProductStore = {
  ensureDefaultCompany(input?: OuiEnsureDefaultCompanyInput): Promise<{
    company: OuiCompanyRecord;
    leader: OuiAgentRecord | null;
  }>;
  getCompany(companyId: string): Promise<OuiCompanyRecord | null>;
  listAgents(companyId: string): Promise<OuiAgentRecord[]>;
  getAgent(agentId: string): Promise<OuiAgentRecord | null>;
  createAgent(input: OuiCreateAgentInput): Promise<OuiAgentRecord>;
  setDefaultLeaderAgent(companyId: string, agentId: string, now?: Date): Promise<OuiCompanyRecord>;
  createTask(input: OuiCreateTaskInput): Promise<OuiTaskRecord>;
  getTask(taskId: string): Promise<OuiTaskRecord | null>;
  addTaskDependency(
    taskId: string,
    dependsOnTaskId: string,
    now?: Date,
  ): Promise<OuiTaskDependencyRecord>;
  getTaskReadiness(taskId: string): Promise<OuiTaskReadiness>;
  assignTask(taskId: string, agentId: string, now?: Date): Promise<OuiTaskRecord>;
  transitionTaskReview(
    taskId: string,
    next: OuiTaskReviewState,
    now?: Date,
  ): Promise<OuiTaskRecord>;
  updateTaskStatus(taskId: string, status: OuiTaskStatus, now?: Date): Promise<OuiTaskRecord>;
  attachRunToTask(
    taskId: string,
    runId: string,
    kind?: OuiTaskRunLink["kind"],
    now?: Date,
  ): Promise<OuiTaskRunLink>;
  listTaskRunLinks(taskId: string): Promise<OuiTaskRunLink[]>;
  recordCostEvent(input: {
    id?: string;
    runId?: string | null;
    taskId?: string | null;
    agentId?: string | null;
    amountMicros?: number | null;
    currency?: string | null;
    usage?: OuiJsonObject;
    source: string;
    now?: Date;
  }): Promise<OuiCostEventRecord>;
  listCostEventsForRun(runId: string): Promise<OuiCostEventRecord[]>;
};

export type OuiTaskRunEnqueue = OuiEnqueueRunInput & {
  taskId: string;
};

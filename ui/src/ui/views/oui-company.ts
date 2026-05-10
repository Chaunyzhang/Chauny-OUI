import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  OuiAgentRecord,
  OuiEmployeeAdapterPreview,
  OuiTaskRecord,
  OuiTaskReviewState,
  OuiTaskTimeline,
} from "../../oui/shared/product-types.ts";
import type { OuiCompanyMessage } from "../controllers/oui-company.ts";
import { icons } from "../icons.ts";
import { ouiCompanyCopy, ouiCompanyStatusLabel } from "../oui-company-copy.ts";

export type OuiCompanyProps = {
  loading: boolean;
  busy: boolean;
  apiAvailable: boolean;
  error: string | null;
  message: OuiCompanyMessage | null;
  company: { id: string; name: string; defaultLeaderAgentId?: string | null } | null;
  agents: OuiAgentRecord[];
  tasks: OuiTaskRecord[];
  adapters: OuiEmployeeAdapterPreview[];
  timeline: OuiTaskTimeline | null;
  selectedTaskId: string | null;
  draftTitle: string;
  draftDescription: string;
  draftAgentId: string;
  onRefresh: () => void | Promise<void>;
  onDraftTitleChange: (next: string) => void;
  onDraftDescriptionChange: (next: string) => void;
  onDraftAgentChange: (next: string) => void;
  onCreateTask: () => void | Promise<void>;
  onSelectTask: (taskId: string) => void | Promise<void>;
  onAssignTask: (taskId: string, agentId: string) => void | Promise<void>;
  onQueueRun: (taskId: string) => void | Promise<void>;
  onReviewTransition: (taskId: string, reviewState: OuiTaskReviewState) => void | Promise<void>;
  onOpenParallelChat: () => void;
};

type TaskColumn = {
  id: OuiTaskRecord["status"];
  label: string;
};

const TASK_COLUMNS: TaskColumn[] = [
  { id: "draft", label: "Draft" },
  { id: "ready", label: "Ready" },
  { id: "blocked", label: "Blocked" },
  { id: "running", label: "Running" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

function oc(text: string): string {
  return ouiCompanyCopy(text);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function agentLabel(agents: OuiAgentRecord[], agentId: string | null | undefined): string {
  if (!agentId) {
    return oc("Unassigned");
  }
  return agents.find((agent) => agent.id === agentId)?.label ?? agentId;
}

function renderMessage(props: OuiCompanyProps) {
  if (props.message) {
    return html`
      <div class="oui-company__message oui-company__message--${props.message.kind}">
        ${props.message.text}
      </div>
    `;
  }
  if (props.error) {
    return html`<div class="oui-company__message oui-company__message--error">${props.error}</div>`;
  }
  return nothing;
}

function renderStatusPill(kind: string, label = kind) {
  return html`
    <span class="oui-company__pill oui-company__pill--${kind}">
      ${ouiCompanyStatusLabel(label)}
    </span>
  `;
}

function renderHero(props: OuiCompanyProps) {
  const leader = props.company?.defaultLeaderAgentId
    ? props.agents.find((agent) => agent.id === props.company?.defaultLeaderAgentId)
    : null;
  const companyName =
    props.company?.name === "OUI Company"
      ? oc("OUI Company")
      : (props.company?.name ?? oc("Company"));
  return html`
    <section class="oui-company__hero">
      <div class="oui-company__hero-main">
        <div class="oui-company__eyebrow">OUI</div>
        <h2>${companyName}</h2>
        <div class="oui-company__hero-actions">
          <button
            class="btn btn--subtle"
            type="button"
            ?disabled=${props.loading}
            @click=${props.onRefresh}
          >
            ${icons.refresh}
            <span>${props.loading ? oc("Refreshing...") : oc("Refresh")}</span>
          </button>
          <button class="btn" type="button" @click=${props.onOpenParallelChat}>
            ${icons.layoutGrid}
            <span>${oc("Four-pane chat")}</span>
          </button>
        </div>
      </div>
      <div class="oui-company__metrics">
        <div class="oui-company__metric">
          <span>${oc("Leader")}</span>
          <strong>${leader?.label ?? "OpenClaw"}</strong>
        </div>
        <div class="oui-company__metric">
          <span>${oc("Tasks")}</span>
          <strong>${String(props.tasks.length)}</strong>
        </div>
        <div class="oui-company__metric">
          <span>${oc("Runs")}</span>
          <strong>${String(props.timeline?.runs.length ?? 0)}</strong>
        </div>
        <div class="oui-company__metric">
          <span>${oc("OUI server")}</span>
          <strong>${props.apiAvailable ? oc("Connected") : oc("Preview")}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderAgentCard(agent: OuiAgentRecord) {
  return html`
    <article
      class="oui-company__agent-card ${agent.isLeader ? "oui-company__agent-card--leader" : ""}"
    >
      <div class="oui-company__agent-avatar">
        ${agent.label.trim().slice(0, 1).toUpperCase() || "A"}
      </div>
      <div class="oui-company__agent-body">
        <div class="oui-company__agent-name">${agent.label}</div>
        <div class="oui-company__agent-meta">
          <span>${agent.adapterKind}</span>
          ${agent.openclawAgentId ? html`<span>${agent.openclawAgentId}</span>` : nothing}
        </div>
      </div>
      <div class="oui-company__agent-tags">
        ${agent.isLeader ? renderStatusPill("leader", "Leader") : nothing}
        ${renderStatusPill(agent.status, agent.status)}
      </div>
    </article>
  `;
}

function renderAdapterPreview(adapter: OuiEmployeeAdapterPreview) {
  return html`
    <article class="oui-company__adapter-card">
      <div>
        <div class="oui-company__adapter-name">${adapter.label}</div>
        <div class="oui-company__adapter-meta">${adapter.kind} / ${adapter.adapterId}</div>
      </div>
      <div class="oui-company__agent-tags">
        ${renderStatusPill(
          adapter.executable ? "active" : "disabled",
          adapter.executable ? "Executable" : "Disabled",
        )}
      </div>
      ${adapter.reason
        ? html`<div class="oui-company__adapter-reason">${oc(adapter.reason)}</div>`
        : nothing}
    </article>
  `;
}

function renderAgents(props: OuiCompanyProps) {
  return html`
    <section class="oui-company__band">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Company")}</div>
          <h3>${oc("OpenClaw-led agents")}</h3>
        </div>
      </div>
      <div class="oui-company__agent-grid">
        ${props.agents.length
          ? repeat(props.agents, (agent) => agent.id, renderAgentCard)
          : html`<div class="oui-company__empty">${oc("No agents yet.")}</div>`}
        ${repeat(props.adapters, (adapter) => adapter.adapterId, renderAdapterPreview)}
      </div>
    </section>
  `;
}

function renderCreateTask(props: OuiCompanyProps) {
  const activeAgents = props.agents.filter((agent) => agent.status === "active");
  return html`
    <section class="oui-company__creator">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Task")}</div>
          <h3>${oc("Create work")}</h3>
        </div>
      </div>
      <div class="oui-company__creator-grid">
        <label class="oui-company__field oui-company__field--title">
          <span>${oc("Title")}</span>
          <input
            .value=${props.draftTitle}
            ?disabled=${props.busy || !props.apiAvailable}
            placeholder=${oc("What should the company do?")}
            @input=${(event: Event) =>
              props.onDraftTitleChange((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="oui-company__field">
          <span>${oc("Assignee")}</span>
          <select
            .value=${props.draftAgentId}
            ?disabled=${props.busy || !props.apiAvailable}
            @change=${(event: Event) =>
              props.onDraftAgentChange((event.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">${oc("Use leader")}</option>
            ${activeAgents.map((agent) => html`<option value=${agent.id}>${agent.label}</option>`)}
          </select>
        </label>
        <label class="oui-company__field oui-company__field--description">
          <span>${oc("Brief")}</span>
          <textarea
            .value=${props.draftDescription}
            ?disabled=${props.busy || !props.apiAvailable}
            placeholder=${oc("Add context, constraints, or expected output.")}
            @input=${(event: Event) =>
              props.onDraftDescriptionChange((event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
        </label>
        <button
          type="button"
          class="btn primary oui-company__create-button"
          ?disabled=${props.busy || !props.apiAvailable || !props.draftTitle.trim()}
          @click=${props.onCreateTask}
        >
          ${icons.plus}
          <span>${oc("Create task")}</span>
        </button>
      </div>
    </section>
  `;
}

function renderTaskActions(props: OuiCompanyProps, task: OuiTaskRecord) {
  const canQueue =
    props.apiAvailable && !props.busy && task.status !== "running" && task.status !== "done";
  const canRequestReview =
    props.apiAvailable &&
    !props.busy &&
    task.reviewState !== "requested" &&
    task.reviewState !== "approved";
  const canDecideReview = props.apiAvailable && !props.busy && task.reviewState === "requested";
  return html`
    <div class="oui-company__task-actions">
      <button
        class="btn btn--sm"
        type="button"
        ?disabled=${!canQueue}
        @click=${() => props.onQueueRun(task.id)}
      >
        ${icons.send}
        <span>${oc("Run")}</span>
      </button>
      <button
        class="btn btn--sm btn--subtle"
        type="button"
        ?disabled=${!canRequestReview}
        @click=${() => props.onReviewTransition(task.id, "requested")}
      >
        ${icons.eye}
        <span>${oc("Review")}</span>
      </button>
      <button
        class="btn btn--sm btn--subtle"
        type="button"
        ?disabled=${!canDecideReview}
        @click=${() => props.onReviewTransition(task.id, "approved")}
      >
        ${icons.check}
        <span>${oc("Done")}</span>
      </button>
      <button
        class="btn btn--sm btn--subtle"
        type="button"
        ?disabled=${!canDecideReview}
        @click=${() => props.onReviewTransition(task.id, "changes_requested")}
      >
        ${icons.cornerDownRight}
        <span>${oc("Changes")}</span>
      </button>
    </div>
  `;
}

function renderTaskCard(props: OuiCompanyProps, task: OuiTaskRecord) {
  const selected = props.selectedTaskId === task.id;
  return html`
    <article class="oui-company__task-card ${selected ? "oui-company__task-card--selected" : ""}">
      <button
        class="oui-company__task-open"
        type="button"
        @click=${() => props.onSelectTask(task.id)}
      >
        <span class="oui-company__task-title">${task.title}</span>
        <span class="oui-company__task-time">${formatDate(task.updatedAt)}</span>
      </button>
      ${task.description
        ? html`<div class="oui-company__task-description">${task.description}</div>`
        : nothing}
      <div class="oui-company__task-meta">
        ${renderStatusPill(task.status, task.status)}
        ${renderStatusPill(`review-${task.reviewState}`, task.reviewState.replace(/_/g, " "))}
      </div>
      <label class="oui-company__task-assignee">
        <span>${oc("Assignee")}</span>
        <select
          .value=${task.assignedAgentId ?? ""}
          ?disabled=${props.busy || !props.apiAvailable}
          @change=${(event: Event) => {
            const agentId = (event.currentTarget as HTMLSelectElement).value;
            if (agentId) {
              void props.onAssignTask(task.id, agentId);
            }
          }}
        >
          <option value="">${oc("Unassigned")}</option>
          ${props.agents
            .filter((agent) => agent.status === "active")
            .map((agent) => html`<option value=${agent.id}>${agent.label}</option>`)}
        </select>
      </label>
      ${renderTaskActions(props, task)}
    </article>
  `;
}

function renderTaskBoard(props: OuiCompanyProps) {
  return html`
    <section class="oui-company__board">
      ${TASK_COLUMNS.map((column) => {
        const tasks = props.tasks.filter((task) => task.status === column.id);
        return html`
          <div class="oui-company__column">
            <div class="oui-company__column-head">
              <span>${oc(column.label)}</span>
              <strong>${String(tasks.length)}</strong>
            </div>
            <div class="oui-company__column-list">
              ${tasks.length
                ? repeat(
                    tasks,
                    (task) => task.id,
                    (task) => renderTaskCard(props, task),
                  )
                : html`<div class="oui-company__empty oui-company__empty--compact">
                    ${oc("Empty")}
                  </div>`}
            </div>
          </div>
        `;
      })}
    </section>
  `;
}

function renderTimelineRun(runEntry: OuiTaskTimeline["runs"][number]) {
  const run = runEntry.run;
  return html`
    <article class="oui-company__run-card">
      <div class="oui-company__run-head">
        <div>
          <div class="oui-company__run-id">${run?.id ?? runEntry.link.runId}</div>
          <div class="oui-company__run-meta">
            ${run?.adapterKind ?? "unknown"} / ${run?.sessionKey ?? "session"}
          </div>
        </div>
        ${renderStatusPill(run?.status ?? "missing", run?.status ?? "missing")}
      </div>
      ${run?.result
        ? html`<pre class="oui-company__json">${JSON.stringify(run.result, null, 2)}</pre>`
        : nothing}
      ${runEntry.costEvents.length
        ? html`
            <div class="oui-company__cost-row">
              ${runEntry.costEvents.map(
                (event) => html`
                  <span>
                    ${event.currency ?? "usage"}
                    ${event.amountMicros != null ? String(event.amountMicros) : ""}
                  </span>
                `,
              )}
            </div>
          `
        : nothing}
      <div class="oui-company__logs">
        ${runEntry.logs.length
          ? runEntry.logs.map(
              (log) => html`
                <div class="oui-company__log">
                  <span>${log.level}</span>
                  <code>${log.message}</code>
                </div>
              `,
            )
          : html`<div class="oui-company__empty oui-company__empty--compact">
              ${oc("No logs yet")}
            </div>`}
      </div>
    </article>
  `;
}

function renderTimeline(props: OuiCompanyProps) {
  const selectedTask =
    props.timeline?.task ?? props.tasks.find((task) => task.id === props.selectedTaskId) ?? null;
  return html`
    <aside class="oui-company__timeline">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Run timeline")}</div>
          <h3>${selectedTask?.title ?? oc("Select a task")}</h3>
        </div>
        ${selectedTask
          ? html`
              <button
                class="btn btn--sm btn--subtle"
                type="button"
                ?disabled=${props.busy}
                @click=${() => props.onSelectTask(selectedTask.id)}
              >
                ${icons.refresh}
                <span>${oc("Refresh")}</span>
              </button>
            `
          : nothing}
      </div>
      ${props.timeline?.readiness && !props.timeline.readiness.ready
        ? html`
            <div class="oui-company__message oui-company__message--error">
              ${oc("Blocked by")} ${props.timeline.readiness.pendingDependencyIds.join(", ")}
            </div>
          `
        : nothing}
      ${selectedTask
        ? html`
            <div class="oui-company__timeline-task">
              <span>${renderStatusPill(selectedTask.status, selectedTask.status)}</span>
              <span
                >${oc("Assigned to")}
                ${agentLabel(props.agents, selectedTask.assignedAgentId)}</span
              >
            </div>
          `
        : html`<div class="oui-company__empty">${oc("No task selected.")}</div>`}
      <div class="oui-company__timeline-runs">
        ${props.timeline?.runs.length
          ? repeat(props.timeline.runs, (entry) => entry.link.runId, renderTimelineRun)
          : html`<div class="oui-company__empty">${oc("No runs yet.")}</div>`}
      </div>
    </aside>
  `;
}

export function renderOuiCompany(props: OuiCompanyProps) {
  return html`
    <section class="oui-company">
      ${renderHero(props)} ${renderMessage(props)}
      ${!props.loading && !props.apiAvailable
        ? html`
            <div class="oui-company__message oui-company__message--error">
              ${oc("OUI server is not active. Company actions are preview-only.")}
            </div>
          `
        : nothing}
      ${renderAgents(props)}
      <div class="oui-company__work">
        <div class="oui-company__work-main">
          ${renderCreateTask(props)} ${renderTaskBoard(props)}
        </div>
        ${renderTimeline(props)}
      </div>
    </section>
  `;
}

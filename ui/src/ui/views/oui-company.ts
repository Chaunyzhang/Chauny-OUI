import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  OuiAgentRecord,
  OuiCompanyRecord,
  OuiCompanySummary,
  OuiControlRoomReadModel,
  OuiConversationRecord,
  OuiEmployeeAdapterPreview,
  OuiInboxItemRecord,
  OuiMessageRecord,
  OuiRunbookRecord,
  OuiRunbookVersionRecord,
  OuiTaskRecord,
  OuiTaskReviewState,
  OuiTaskTimeline,
  OuiWorkNodeRecord,
} from "../../oui/shared/product-types.ts";
import type { OuiCompanyCeoCandidate, OuiCompanyMessage } from "../controllers/oui-company.ts";
import { icons } from "../icons.ts";
import { ouiCompanyCopy, ouiCompanyStatusLabel } from "../oui-company-copy.ts";

export type OuiCompanyProps = {
  loading: boolean;
  busy: boolean;
  apiAvailable: boolean;
  error: string | null;
  message: OuiCompanyMessage | null;
  companySummaries: OuiCompanySummary[];
  company: OuiCompanyRecord | null;
  ceoCandidates: OuiCompanyCeoCandidate[];
  agents: OuiAgentRecord[];
  ceoConversations: OuiConversationRecord[];
  ceoMessages: OuiMessageRecord[];
  tasks: OuiTaskRecord[];
  runbooks: OuiRunbookRecord[];
  runbookVersions: OuiRunbookVersionRecord[];
  activeRunbookVersion: OuiRunbookVersionRecord | null;
  workNodes: OuiWorkNodeRecord[];
  inboxItems: OuiInboxItemRecord[];
  controlRoom: OuiControlRoomReadModel | null;
  adapters: OuiEmployeeAdapterPreview[];
  timeline: OuiTaskTimeline | null;
  selectedTaskId: string | null;
  createCompanyName: string;
  createCompanyCeoId: string;
  ceoDraft: string;
  draftTitle: string;
  draftDescription: string;
  draftAgentId: string;
  onRefresh: () => void | Promise<void>;
  onSelectCompany: (companyId: string) => void | Promise<void>;
  onCreateCompanyNameChange: (next: string) => void;
  onCreateCompanyCeoChange: (next: string) => void;
  onCreateCompany: () => void | Promise<void>;
  onCeoDraftChange: (next: string) => void;
  onSendCeoMessage: () => void | Promise<void>;
  onGenerateRunbookDraft: () => void | Promise<void>;
  onStartRunbookVersion: (versionId: string) => void | Promise<void>;
  onDraftTitleChange: (next: string) => void;
  onDraftDescriptionChange: (next: string) => void;
  onDraftAgentChange: (next: string) => void;
  onCreateTask: () => void | Promise<void>;
  onSelectTask: (taskId: string) => void | Promise<void>;
  onAssignTask: (taskId: string, agentId: string) => void | Promise<void>;
  onQueueRun: (taskId: string) => void | Promise<void>;
  onReviewTransition: (taskId: string, reviewState: OuiTaskReviewState) => void | Promise<void>;
  onOpenCeoChat: () => void;
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

function jsonObjectString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stageLabel(stage: Record<string, unknown>, index: number): string {
  return (
    jsonObjectString(stage.title) ||
    jsonObjectString(stage.name) ||
    jsonObjectString(stage.id) ||
    oc("Stage {index}").replace("{index}", String(index + 1))
  );
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
  const waitingCount = props.companySummaries.filter(
    (summary) => summary.company.status === "waiting_user",
  ).length;
  const runningCount = props.companySummaries.filter(
    (summary) => summary.company.status === "running",
  ).length;
  return html`
    <section class="oui-company__hero">
      <div class="oui-company__hero-main">
        <div class="oui-company__eyebrow">OUI</div>
        <h2>${oc("Company dashboard")}</h2>
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
          <span>${oc("Companies")}</span>
          <strong>${String(props.companySummaries.length)}</strong>
        </div>
        <div class="oui-company__metric">
          <span>${oc("Waiting for you")}</span>
          <strong>${String(waitingCount)}</strong>
        </div>
        <div class="oui-company__metric">
          <span>${oc("Running")}</span>
          <strong>${String(runningCount)}</strong>
        </div>
        <div class="oui-company__metric">
          <span>${oc("OUI server")}</span>
          <strong>${props.apiAvailable ? oc("Connected") : oc("Disconnected")}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderCompanyDashboard(props: OuiCompanyProps) {
  const summaries = props.companySummaries;
  const selectedCompanyId = props.company?.id ?? null;
  const selectedCeoId = props.createCompanyCeoId || props.ceoCandidates[0]?.id || "";
  const canCreateCompany =
    props.apiAvailable &&
    !props.busy &&
    Boolean(props.createCompanyName.trim()) &&
    Boolean(selectedCeoId);
  return html`
    <section class="oui-company__dashboard">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Companies")}</div>
          <h3>${oc("Your AI companies")}</h3>
        </div>
      </div>
      <div class="oui-company__company-create">
        <label class="oui-company__field oui-company__field--company-name">
          <span>${oc("New company")}</span>
          <input
            .value=${props.createCompanyName}
            ?disabled=${props.busy || !props.apiAvailable}
            placeholder=${oc("Company name")}
            @input=${(event: Event) =>
              props.onCreateCompanyNameChange((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="oui-company__field">
          <span>${oc("CEO")}</span>
          <select
            .value=${selectedCeoId}
            ?disabled=${props.busy || !props.apiAvailable || !props.ceoCandidates.length}
            @change=${(event: Event) =>
              props.onCreateCompanyCeoChange((event.currentTarget as HTMLSelectElement).value)}
          >
            ${props.ceoCandidates.length
              ? props.ceoCandidates.map(
                  (candidate) => html`
                    <option value=${candidate.id}>
                      ${candidate.label}${candidate.modelRef ? ` / ${candidate.modelRef}` : ""}
                    </option>
                  `,
                )
              : html`<option value="">${oc("Connect Gateway to choose CEO")}</option>`}
          </select>
        </label>
        <button
          type="button"
          class="btn primary oui-company__create-company-button"
          ?disabled=${!canCreateCompany}
          @click=${props.onCreateCompany}
        >
          ${icons.plus}
          <span>${oc("Create company")}</span>
        </button>
      </div>
      <div class="oui-company__company-grid">
        ${summaries.length
          ? repeat(
              summaries,
              (summary) => summary.company.id,
              (summary) => {
                const company = summary.company;
                const selected = company.id === selectedCompanyId;
                return html`
                  <button
                    type="button"
                    class="oui-company__company-card ${selected
                      ? "oui-company__company-card--selected"
                      : ""}"
                    ?disabled=${props.busy}
                    @click=${() => props.onSelectCompany(company.id)}
                  >
                    <div class="oui-company__company-card-head">
                      <span
                        >${company.name === "OUI Company" ? oc("OUI Company") : company.name}</span
                      >
                      ${renderStatusPill(company.status, company.status)}
                    </div>
                    <div class="oui-company__company-line">
                      <span>${oc("CEO")}</span>
                      <strong>${summary.ceo?.label ?? company.ceoAgentId ?? oc("Not set")}</strong>
                    </div>
                    <div class="oui-company__company-objective">
                      ${company.currentObjective ?? oc("No active objective yet.")}
                    </div>
                    <div class="oui-company__company-meta">
                      <span>${oc("Stage")}: ${company.currentStage ?? oc("Idle")}</span>
                      <span>${oc("Inbox")}: ${String(summary.openInboxCount)}</span>
                      <span>${oc("Tasks")}: ${String(summary.taskCount)}</span>
                      <span>${oc("Last activity")}: ${formatDate(summary.latestActivityAt)}</span>
                    </div>
                  </button>
                `;
              },
            )
          : html`<div class="oui-company__empty">${oc("No companies yet.")}</div>`}
      </div>
    </section>
  `;
}

function renderCompanyDetailTabs() {
  const tabs = [
    "Control room",
    "CEO private chat",
    "Inbox center",
    "Runbooks",
    "Organization",
    "Artifacts",
    "Internal records",
    "Settings",
  ];
  return html`
    <nav class="oui-company__detail-tabs" aria-label=${oc("Company sections")}>
      ${tabs.map(
        (tab, index) => html`
          <a
            class=${index === 0 ? "oui-company__detail-tab--active" : ""}
            href="#${tab.toLowerCase().replace(/\s+/g, "-")}"
          >
            ${oc(tab)}
          </a>
        `,
      )}
    </nav>
  `;
}

function renderControlRoom(props: OuiCompanyProps) {
  const controlRoom = props.controlRoom;
  const nodes = controlRoom?.nodes ?? [];
  return html`
    <section class="oui-company__band" id="control-room">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Monitor")}</div>
          <h3>${oc("Control room")}</h3>
        </div>
        ${renderStatusPill(props.company?.status ?? "idle", props.company?.status ?? "idle")}
      </div>
      <div class="oui-company__control-summary">
        <div>
          <span>${oc("Current objective")}</span>
          <strong>${controlRoom?.currentObjective ?? oc("No active objective yet.")}</strong>
        </div>
        <div>
          <span>${oc("Current stage")}</span>
          <strong>${controlRoom?.currentStage ?? oc("Idle")}</strong>
        </div>
        <div>
          <span>${oc("Open inbox")}</span>
          <strong>${String(controlRoom?.openInboxItems.length ?? 0)}</strong>
        </div>
        <div>
          <span>${oc("Active runbook")}</span>
          <strong>${controlRoom?.activeRunbook?.title ?? oc("No runbook approved yet.")}</strong>
        </div>
      </div>
      <div class="oui-company__next-step">
        <span>${oc("Next step")}</span>
        <strong
          >${oc(
            controlRoom?.nextStep ??
              "Talk to the CEO and approve a runbook before the company starts work.",
          )}</strong
        >
      </div>
      <div class="oui-company__node-grid">
        ${nodes.length
          ? repeat(
              nodes,
              (node) => node.id,
              (node) => html`
                <article class="oui-company__node-card">
                  <div class="oui-company__node-head">
                    <strong>${node.title}</strong>
                    ${renderStatusPill(node.status, node.status)}
                  </div>
                  <div class="oui-company__node-meta">
                    <span>${node.assigneeLabel ?? oc("Unassigned")}</span>
                    ${node.updatedAt ? html`<span>${formatDate(node.updatedAt)}</span>` : nothing}
                  </div>
                  ${node.summary
                    ? html`<div class="oui-company__node-summary">${node.summary}</div>`
                    : nothing}
                </article>
              `,
            )
          : html`<div class="oui-company__empty">${oc("No control-room nodes yet.")}</div>`}
      </div>
    </section>
  `;
}

function renderCeoPanel(props: OuiCompanyProps) {
  const ceo =
    props.agents.find((agent) => agent.id === props.company?.ceoAgentId) ??
    props.agents.find((agent) => agent.id === props.company?.defaultLeaderAgentId) ??
    props.agents.find((agent) => agent.isLeader) ??
    null;
  const canSend = props.apiAvailable && !props.busy && Boolean(props.ceoDraft.trim());
  const canGenerateRunbook =
    props.apiAvailable &&
    !props.busy &&
    props.ceoMessages.some((message) => message.role === "user");
  return html`
    <section class="oui-company__band" id="ceo-private-chat">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">CEO</div>
          <h3>${oc("CEO private chat")}</h3>
        </div>
        <div class="oui-company__section-actions">
          <button
            class="btn btn--subtle btn--sm"
            type="button"
            ?disabled=${!canGenerateRunbook}
            @click=${props.onGenerateRunbookDraft}
          >
            ${icons.fileText}
            <span>${oc("Generate runbook draft")}</span>
          </button>
          <button class="btn btn--subtle btn--sm" type="button" @click=${props.onOpenCeoChat}>
            ${icons.messageSquare}
            <span>${oc("Open OUI chat")}</span>
          </button>
        </div>
      </div>
      <div class="oui-company__ceo-strip">
        <div class="oui-company__agent-avatar">
          ${(ceo?.label ?? "C").trim().slice(0, 1).toUpperCase() || "C"}
        </div>
        <div>
          <strong>${ceo?.label ?? oc("Not set")}</strong>
          <span>${oc("OpenClaw agent")}: ${ceo?.openclawAgentId ?? oc("Not set")}</span>
        </div>
      </div>
      <div class="oui-company__ceo-chat-log">
        ${props.ceoMessages.length
          ? repeat(
              props.ceoMessages,
              (message) => message.id,
              (message) => html`
                <article class="oui-company__ceo-message oui-company__ceo-message--${message.role}">
                  <div class="oui-company__ceo-message-head">
                    <strong>${message.role === "user" ? oc("You") : oc("CEO")}</strong>
                    <span>${formatDate(message.createdAt)}</span>
                  </div>
                  <p>${message.content}</p>
                </article>
              `,
            )
          : html`<div class="oui-company__empty oui-company__empty--compact">
              ${oc("Talk with the CEO to shape company direction.")}
            </div>`}
      </div>
      <div class="oui-company__ceo-composer">
        <textarea
          .value=${props.ceoDraft}
          ?disabled=${props.busy || !props.apiAvailable}
          placeholder=${oc("Tell the CEO what this company should think about next.")}
          @input=${(event: Event) =>
            props.onCeoDraftChange((event.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <button
          class="btn primary"
          type="button"
          ?disabled=${!canSend}
          @click=${props.onSendCeoMessage}
        >
          ${icons.send}
          <span>${oc("Send to CEO")}</span>
        </button>
      </div>
    </section>
  `;
}

function renderInbox(props: OuiCompanyProps) {
  return html`
    <section class="oui-company__band" id="inbox-center">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Inbox")}</div>
          <h3>${oc("Inbox center")}</h3>
        </div>
      </div>
      <div class="oui-company__inbox-list">
        ${props.inboxItems.length
          ? repeat(
              props.inboxItems,
              (item) => item.id,
              (item) => html`
                <article class="oui-company__inbox-card">
                  <div class="oui-company__node-head">
                    <strong>${item.title}</strong>
                    ${renderStatusPill(item.status, item.status)}
                  </div>
                  <div class="oui-company__node-meta">
                    <span>${oc(item.itemType)}</span>
                    <span>${formatDate(item.updatedAt)}</span>
                  </div>
                  ${item.summary
                    ? html`<div class="oui-company__node-summary">${item.summary}</div>`
                    : nothing}
                </article>
              `,
            )
          : html`<div class="oui-company__empty">${oc("No inbox items.")}</div>`}
      </div>
    </section>
  `;
}

function renderRunbooks(props: OuiCompanyProps) {
  const activeVersion = props.activeRunbookVersion;
  const versions = props.runbookVersions;
  const canStart = (version: OuiRunbookVersionRecord) =>
    props.apiAvailable &&
    !props.busy &&
    !["active", "completed", "archived", "superseded"].includes(version.status);
  const runbookTitle = (version: OuiRunbookVersionRecord) =>
    props.runbooks.find((runbook) => runbook.id === version.runbookId)?.title ?? oc("Runbook");
  return html`
    <section class="oui-company__band" id="runbooks">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Runbook")}</div>
          <h3>${oc("Runbooks")}</h3>
        </div>
        ${activeVersion
          ? renderStatusPill(activeVersion.status, activeVersion.status)
          : renderStatusPill("idle", "Idle")}
      </div>
      ${activeVersion
        ? html`
            <div class="oui-company__runbook-active">
              <div>
                <span>${oc("Active version")}</span>
                <strong
                  >${ouiCompanyCopy("Version {version}", {
                    version: activeVersion.version,
                  })}</strong
                >
              </div>
              <div>
                <span>${oc("Mode")}</span>
                <strong>${oc(activeVersion.operatingMode)}</strong>
              </div>
              <div>
                <span>${oc("Source")}</span>
                <strong>${oc(activeVersion.sourceType)}</strong>
              </div>
            </div>
            <div class="oui-company__stage-list">
              <span>${oc("Stages")}</span>
              ${activeVersion.stages.length
                ? activeVersion.stages.map(
                    (stage, index) => html`<span>${stageLabel(stage, index)}</span>`,
                  )
                : html`<span>${oc("No stages yet.")}</span>`}
            </div>
          `
        : html`<div class="oui-company__empty">${oc("No active runbook yet.")}</div>`}
      <div class="oui-company__runbook-list">
        ${versions.length
          ? repeat(
              versions,
              (version) => version.id,
              (version) => {
                const versionNodes = props.workNodes.filter(
                  (node) => node.runbookVersionId === version.id,
                );
                return html`
                  <article class="oui-company__runbook-card">
                    <div class="oui-company__runbook-title-row">
                      <strong>${runbookTitle(version)}</strong>
                      ${renderStatusPill(version.status, version.status)}
                    </div>
                    <div class="oui-company__node-meta">
                      <span
                        >${ouiCompanyCopy("Version {version}", {
                          version: version.version,
                        })}</span
                      >
                      <span>${oc("Mode")}: ${oc(version.operatingMode)}</span>
                      <span>${oc("Updated")}: ${formatDate(version.updatedAt)}</span>
                    </div>
                    <p>${version.objective}</p>
                    <div class="oui-company__stage-list">
                      <span>${oc("Stages")}</span>
                      ${version.stages.length
                        ? version.stages.map(
                            (stage, index) => html`<span>${stageLabel(stage, index)}</span>`,
                          )
                        : html`<span>${oc("No stages yet.")}</span>`}
                    </div>
                    ${versionNodes.length
                      ? html`
                          <div class="oui-company__stage-list">
                            <span>${oc("Work nodes")}</span>
                            ${versionNodes.map(
                              (node) => html` <span>${node.title} - ${oc(node.status)}</span> `,
                            )}
                          </div>
                        `
                      : nothing}
                    <div class="oui-company__runbook-actions">
                      <button
                        class="btn btn--primary btn--sm"
                        type="button"
                        ?disabled=${!canStart(version)}
                        @click=${() => props.onStartRunbookVersion(version.id)}
                      >
                        ${icons.zap}
                        <span>${oc("Confirm and start")}</span>
                      </button>
                    </div>
                  </article>
                `;
              },
            )
          : html`<div class="oui-company__empty">${oc("No runbook drafts yet.")}</div>`}
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
  const companyName =
    props.company?.name === "OUI Company"
      ? oc("OUI Company")
      : (props.company?.name ?? oc("Company"));
  return html`
    <section class="oui-company__band" id="organization">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Company")}</div>
          <h3>${companyName}</h3>
        </div>
      </div>
      <div class="oui-company__company-detail-strip">
        <span
          >${oc("CEO")}:
          ${agentLabel(
            props.agents,
            props.company?.ceoAgentId ?? props.company?.defaultLeaderAgentId,
          )}</span
        >
        <span>${oc("Status")}: ${ouiCompanyStatusLabel(props.company?.status ?? "unknown")}</span>
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
              ${oc("OUI server is not connected. Company actions require OUI server.")}
            </div>
          `
        : nothing}
      ${renderCompanyDashboard(props)}
      ${props.company
        ? html`
            ${renderCompanyDetailTabs()} ${renderControlRoom(props)}
            <div class="oui-company__detail-grid">
              ${renderCeoPanel(props)} ${renderInbox(props)} ${renderRunbooks(props)}
            </div>
            ${renderAgents(props)}
          `
        : nothing}
      <div class="oui-company__work">
        <div class="oui-company__work-main">
          <div class="oui-company__section-head oui-company__internal-head" id="internal-records">
            <div>
              <div class="oui-company__eyebrow">${oc("Internal records")}</div>
              <h3>${oc("Task workbench")}</h3>
            </div>
          </div>
          ${props.company ? html`${renderCreateTask(props)} ${renderTaskBoard(props)}` : nothing}
        </div>
        ${props.company ? renderTimeline(props) : nothing}
      </div>
    </section>
  `;
}

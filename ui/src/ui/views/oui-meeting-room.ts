import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  OuiArtifactRecord,
  OuiMeetingDiscussionState,
  OuiMeetingMessageRecord,
  OuiMeetingParticipant,
  OuiMeetingRecord,
} from "../../oui/shared/product-types.ts";
import {
  sortMeetingParticipants,
  type OuiMeetingParticipantCandidate,
  type OuiMeetingRoomMessage,
} from "../controllers/oui-meeting-room.ts";
import { icons } from "../icons.ts";
import { ouiCompanyCopy, ouiCompanyStatusLabel } from "../oui-company-copy.ts";
import "../components/modal-dialog.ts";
import { renderOuiChat } from "./oui-chat.ts";

type ThinkingIntensity = NonNullable<OuiMeetingParticipant["thinkingIntensity"]>;

const THINKING_INTENSITIES: ThinkingIntensity[] = ["low", "medium", "high"];

export type OuiMeetingRoomProps = {
  loading: boolean;
  busy: boolean;
  error: string | null;
  message: OuiMeetingRoomMessage | null;
  meetings: OuiMeetingRecord[];
  selectedMeetingId: string | null;
  messages: OuiMeetingMessageRecord[];
  artifacts: OuiArtifactRecord[];
  participantCandidates: OuiMeetingParticipantCandidate[];
  titleDraft: string;
  objectiveDraft: string;
  inviteDialogOpen: boolean;
  settingsParticipantId: string | null;
  documentDraft: string;
  participantDraftId: string;
  draftParticipants: OuiMeetingParticipant[];
  promptDraft: string;
  onRefresh: () => void | Promise<void>;
  onSelectMeeting: (meetingId: string) => void | Promise<void>;
  onTitleDraftChange: (next: string) => void;
  onObjectiveDraftChange: (next: string) => void;
  onParticipantDraftChange: (next: string) => void;
  onOpenInviteDialog: () => void;
  onCloseInviteDialog: () => void;
  onOpenParticipantSettings: (participantId: string) => void;
  onCloseParticipantSettings: () => void;
  onAddParticipant: () => void | Promise<void>;
  onRemoveParticipant: (participantId: string) => void | Promise<void>;
  onToggleParticipantMuted: (participantId: string) => void | Promise<void>;
  onSetParticipantSpeakingOrder: (
    participantId: string,
    speakingOrder: number,
  ) => void | Promise<void>;
  onSetParticipantThinkingIntensity: (
    participantId: string,
    thinkingIntensity: ThinkingIntensity,
  ) => void | Promise<void>;
  onDocumentDraftChange: (next: string) => void;
  onSaveDocument: () => void | Promise<void>;
  onReviseModeratorDocument: () => void | Promise<void>;
  onRunNextRound: () => void | Promise<void>;
  onCreateMeeting: () => void | Promise<void>;
  onPromptDraftChange: (next: string) => void;
  onStartMeeting: (meetingId: string) => void | Promise<void>;
  onEndMeeting: (meetingId: string) => void | Promise<void>;
  onGenerateMinutes: (meetingId: string) => void | Promise<void>;
};

function oc(text: string): string {
  return ouiCompanyCopy(text);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function fallbackMeetingDiscussion(meeting: OuiMeetingRecord): OuiMeetingDiscussionState {
  return {
    phase: meeting.status === "ended" ? "ended" : "drafting",
    currentRound: 0,
    activeDocument: {
      round: 0,
      text: [
        `Meeting topic: ${meeting.title}`,
        meeting.objective ? `Context: ${meeting.objective}` : null,
      ]
        .filter((line): line is string => line != null)
        .join("\n"),
      updatedAt: meeting.updatedAt || meeting.createdAt,
      updatedBy: "seed",
    },
    roundHistory: [],
  };
}

function meetingDiscussion(meeting: OuiMeetingRecord): OuiMeetingDiscussionState {
  return meeting.discussion?.activeDocument
    ? meeting.discussion
    : fallbackMeetingDiscussion(meeting);
}

function renderMessage(props: OuiMeetingRoomProps) {
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

function selectedMeeting(props: OuiMeetingRoomProps): OuiMeetingRecord | null {
  return props.meetings.find((meeting) => meeting.id === props.selectedMeetingId) ?? null;
}

function sortedParticipants(participants: readonly OuiMeetingParticipant[]) {
  return sortMeetingParticipants(participants);
}

function meetingParticipantLabel(
  meeting: OuiMeetingRecord,
  participantId: string | null | undefined,
): string {
  if (!participantId) {
    return oc("Agent");
  }
  return (
    meeting.participants.find((participant) => participant.id === participantId)?.label ??
    participantId
  );
}

function isMeetingPlaceholderMessage(message: OuiMeetingMessageRecord): boolean {
  const text = message.content.trim();
  return (
    /^Run oui-meeting:.*finished with status (queued|starting|running)\.$/i.test(text) ||
    text === "OpenClaw accepted the run, but no terminal chat event was observed." ||
    text === "OpenClaw run completed."
  );
}

function visibleMeetingMessages(messages: readonly OuiMeetingMessageRecord[]) {
  return messages.filter((message) => {
    if (message.role === "owner") {
      return false;
    }
    if (isMeetingPlaceholderMessage(message)) {
      return false;
    }
    return true;
  });
}

function mapMeetingMessagesForChat(meeting: OuiMeetingRecord, messages: OuiMeetingMessageRecord[]) {
  return visibleMeetingMessages(messages).map((message) => {
    const timestamp = new Date(message.createdAt).getTime();
    const source =
      message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
        ? (message.metadata.source as string | undefined)
        : undefined;
    const senderLabel =
      message.role === "system"
        ? source?.startsWith("meeting_moderator")
          ? oc("Moderator")
          : oc("System")
        : message.role === "owner"
          ? oc("You")
          : meetingParticipantLabel(meeting, message.participantId);
    return {
      id: message.id,
      role: message.role === "owner" ? "user" : "assistant",
      content: message.content,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
      senderLabel,
    };
  });
}

function availableParticipantCandidates(
  props: OuiMeetingRoomProps,
  participants: readonly OuiMeetingParticipant[],
) {
  const invitedIds = new Set(participants.map((participant) => participant.id));
  return props.participantCandidates.filter((candidate) => !invitedIds.has(candidate.id));
}

function selectedInviteCandidate(
  props: OuiMeetingRoomProps,
  participants: readonly OuiMeetingParticipant[],
) {
  const available = availableParticipantCandidates(props, participants);
  if (!available.length) {
    return { available, selectedId: "" };
  }
  const fallbackId = available[0]?.id ?? "";
  const selectedId = available.some((candidate) => candidate.id === props.participantDraftId)
    ? props.participantDraftId
    : fallbackId;
  return { available, selectedId };
}

function thinkingIntensityLabel(value: ThinkingIntensity) {
  switch (value) {
    case "low":
      return oc("Low");
    case "high":
      return oc("High");
    case "medium":
    default:
      return oc("Medium");
  }
}

function participantThinkingIntensity(participant: OuiMeetingParticipant): ThinkingIntensity {
  return participant.thinkingIntensity ?? "medium";
}

function participantById(
  participants: readonly OuiMeetingParticipant[],
  participantId: string | null,
) {
  return participants.find((participant) => participant.id === participantId) ?? null;
}

function renderInviteDialog(
  props: OuiMeetingRoomProps,
  participants: readonly OuiMeetingParticipant[],
) {
  if (!props.inviteDialogOpen) {
    return nothing;
  }
  const { available, selectedId } = selectedInviteCandidate(props, participants);
  return html`
    <openclaw-modal-dialog
      label=${oc("Invite agent")}
      description=${oc("Choose an agent to add to this meeting.")}
      @modal-cancel=${props.onCloseInviteDialog}
    >
      <div class="oui-meeting-room__invite-dialog">
        <div class="oui-meeting-room__invite-head">
          <div>
            <div class="oui-company__eyebrow">${oc("Meeting")}</div>
            <h3>${oc("Invite agent")}</h3>
            <p>${oc("Choose an agent to add to this meeting.")}</p>
          </div>
        </div>
        <div class="oui-meeting-room__invite-list">
          ${available.length
            ? repeat(
                available,
                (candidate) => candidate.id,
                (candidate) => {
                  const selected = candidate.id === selectedId;
                  return html`
                    <button
                      type="button"
                      class="oui-meeting-room__invite-card ${selected
                        ? "oui-meeting-room__invite-card--selected"
                        : ""}"
                      ?disabled=${props.busy}
                      @click=${() => props.onParticipantDraftChange(candidate.id)}
                    >
                      <div class="oui-company__agent-avatar">
                        ${candidate.label.trim().slice(0, 1).toUpperCase() || "A"}
                      </div>
                      <div class="oui-company__agent-body">
                        <div class="oui-company__agent-name">${candidate.label}</div>
                        <div class="oui-company__agent-meta">
                          <span>${candidate.adapterKind}</span>
                          ${candidate.modelRef ? html`<span>${candidate.modelRef}</span>` : nothing}
                        </div>
                      </div>
                    </button>
                  `;
                },
              )
            : html`<div class="oui-company__empty oui-company__empty--compact">
                ${oc("No available agents to invite.")}
              </div>`}
        </div>
        <div class="oui-meeting-room__invite-actions">
          <button
            class="btn btn--subtle"
            type="button"
            ?disabled=${props.busy}
            @click=${props.onCloseInviteDialog}
          >
            ${oc("Cancel")}
          </button>
          <button
            class="btn primary"
            type="button"
            ?disabled=${props.busy || !available.length}
            @click=${props.onAddParticipant}
          >
            ${icons.plus}
            <span>${oc("Invite selected agent")}</span>
          </button>
        </div>
      </div>
    </openclaw-modal-dialog>
  `;
}

function renderParticipantSettingsDialog(
  props: OuiMeetingRoomProps,
  participants: readonly OuiMeetingParticipant[],
) {
  const participant = participantById(participants, props.settingsParticipantId);
  if (!participant) {
    return nothing;
  }
  const thinkingIntensity = participantThinkingIntensity(participant);
  return html`
    <openclaw-modal-dialog
      label=${oc("Agent settings")}
      description=${oc("Adjust agent meeting preferences.")}
      @modal-cancel=${props.onCloseParticipantSettings}
    >
      <div class="oui-meeting-room__settings-dialog">
        <div class="oui-meeting-room__settings-head">
          <div>
            <div class="oui-company__eyebrow">${oc("Agent")}</div>
            <h3>${participant.label}</h3>
            <p>${oc("Adjust agent meeting preferences.")}</p>
          </div>
        </div>
        <div class="oui-meeting-room__settings-section">
          <span>${oc("Thinking intensity")}</span>
          <div class="oui-meeting-room__settings-options">
            ${THINKING_INTENSITIES.map(
              (option) => html`
                <button
                  class="btn ${thinkingIntensity === option ? "primary" : "btn--subtle"}"
                  type="button"
                  ?disabled=${props.busy}
                  @click=${async () => {
                    await props.onSetParticipantThinkingIntensity(participant.id, option);
                    props.onCloseParticipantSettings();
                  }}
                >
                  ${thinkingIntensityLabel(option)}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="oui-meeting-room__settings-actions">
          <button
            class="btn btn--subtle"
            type="button"
            ?disabled=${props.busy}
            @click=${props.onCloseParticipantSettings}
          >
            ${oc("Close")}
          </button>
        </div>
      </div>
    </openclaw-modal-dialog>
  `;
}

function renderSpeakingOrderSection(
  props: OuiMeetingRoomProps,
  participants: readonly OuiMeetingParticipant[],
  editable: boolean,
) {
  return html`
    <section class="oui-meeting-room__order-module">
      <div class="oui-meeting-room__panel-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Agents")}</div>
          <strong>${oc("Speaking order")}</strong>
        </div>
        <span class="oui-company__pill oui-company__pill--active"
          >${String(participants.length)}</span
        >
      </div>
      <div class="oui-meeting-room__order-list">
        ${participants.length
          ? repeat(
              participants,
              (participant) => participant.id,
              (participant, index) => html`
                <div class="oui-meeting-room__order-row">
                  <span class="oui-meeting-room__order-index">#${String(index + 1)}</span>
                  <div class="oui-meeting-room__order-copy">
                    <strong>${participant.label}</strong>
                    <span>${participant.adapterKind}</span>
                  </div>
                  <select
                    .value=${String(index + 1)}
                    ?disabled=${props.busy || !editable}
                    @change=${(event: Event) =>
                      props.onSetParticipantSpeakingOrder(
                        participant.id,
                        Number((event.currentTarget as HTMLSelectElement).value),
                      )}
                  >
                    ${Array.from(
                      { length: participants.length },
                      (_, optionIndex) => optionIndex + 1,
                    ).map(
                      (optionOrder) => html`<option value=${String(optionOrder)}>
                        ${oc("Order")} ${String(optionOrder)}
                      </option>`,
                    )}
                  </select>
                </div>
              `,
            )
          : html`<div class="oui-company__empty oui-company__empty--compact">
              ${oc("No agents invited yet.")}
            </div>`}
      </div>
    </section>
  `;
}

function renderDraftSidebar(props: OuiMeetingRoomProps) {
  const participants = sortedParticipants(props.draftParticipants);
  return html`
    <aside class="oui-meeting-room__sidebar" aria-label=${oc("Meeting details")}>
      <div class="oui-meeting-room__meeting-meta">
        <label class="oui-company__field">
          <span>${oc("Title")}</span>
          <input
            .value=${props.titleDraft}
            ?disabled=${props.busy}
            placeholder=${oc("Meeting title")}
            @input=${(event: Event) =>
              props.onTitleDraftChange((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="oui-company__field">
          <span>${oc("Description")}</span>
          <textarea
            class="oui-meeting-room__description-input"
            .value=${props.objectiveDraft}
            ?disabled=${props.busy}
            placeholder=${oc("What should this meeting discuss?")}
            @input=${(event: Event) =>
              props.onObjectiveDraftChange((event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
        </label>
      </div>
      ${renderSpeakingOrderSection(props, participants, true)}
    </aside>
  `;
}

function renderMeetingSidebar(props: OuiMeetingRoomProps, meeting: OuiMeetingRecord) {
  const participants = sortedParticipants(meeting.participants);
  return html`
    <aside class="oui-meeting-room__sidebar" aria-label=${oc("Meeting details")}>
      <div class="oui-meeting-room__meeting-meta">
        <div class="oui-company__eyebrow">${oc("Meeting")}</div>
        <div class="oui-meeting-room__meeting-meta-head">
          <h3>${meeting.title}</h3>
          ${renderStatusPill(meeting.status, meeting.status)}
        </div>
        <div class="oui-meeting-room__description-card">
          ${meeting.objective?.trim() ? meeting.objective : oc("No objective set.")}
        </div>
      </div>
      ${renderSpeakingOrderSection(props, participants, meeting.status !== "ended")}
    </aside>
  `;
}

function renderMeetingManagementCard(
  props: OuiMeetingRoomProps,
  participant: OuiMeetingParticipant,
  index: number,
  editable: boolean,
) {
  const muted = participant.muted === true;
  const actionDisabled = props.busy || !editable;
  const thinkingIntensity = participantThinkingIntensity(participant);
  return html`
    <article class="oui-meeting-room__participant-card">
      <div class="oui-company__agent-avatar">
        ${participant.label.trim().slice(0, 1).toUpperCase() || "A"}
      </div>
      <div class="oui-company__agent-body">
        <div class="oui-meeting-room__participant-head">
          <div class="oui-company__agent-name">${participant.label}</div>
          <span class="oui-meeting-room__order-badge">#${String(index + 1)}</span>
        </div>
        <div class="oui-company__agent-meta">
          <span>${participant.adapterKind}</span>
          ${participant.modelRef ? html`<span>${participant.modelRef}</span>` : nothing}
        </div>
        <div class="oui-company__agent-tags">
          ${participant.role
            ? html`<span class="oui-company__pill oui-company__pill--active">
                ${participant.role}
              </span>`
            : nothing}
          ${renderStatusPill("running", thinkingIntensityLabel(thinkingIntensity))}
          ${muted
            ? html`<span class="oui-company__pill oui-company__pill--blocked">${oc("Muted")}</span>`
            : nothing}
        </div>
        <div class="oui-meeting-room__participant-actions">
          <button
            class="btn btn--subtle btn--sm"
            type="button"
            ?disabled=${actionDisabled}
            @click=${() => props.onToggleParticipantMuted(participant.id)}
          >
            ${muted ? icons.mic : icons.micOff}
            <span>${muted ? oc("Mic on") : oc("Mic off")}</span>
          </button>
          <button
            class="btn btn--subtle btn--sm"
            type="button"
            ?disabled=${actionDisabled}
            @click=${() => props.onOpenParticipantSettings(participant.id)}
          >
            ${icons.settings}
            <span>${oc("Settings")}</span>
          </button>
          <button
            class="btn btn--subtle btn--sm oui-meeting-room__participant-action--danger"
            type="button"
            ?disabled=${actionDisabled}
            @click=${() => props.onRemoveParticipant(participant.id)}
          >
            ${icons.x}
            <span>${oc("Remove")}</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderMeetingManagementActions(
  props: OuiMeetingRoomProps,
  meeting: OuiMeetingRecord | null,
) {
  const canInvite = !props.busy && (!meeting || meeting.status !== "ended");
  const canCreate = !meeting && !props.busy && Boolean(props.titleDraft.trim());
  const canStart = meeting !== null && !props.busy && meeting.status === "draft";
  const canEnd = meeting !== null && !props.busy && meeting.status !== "ended";
  const canGenerateMinutes = meeting !== null && !props.busy && props.messages.length > 0;
  return html`
    <div class="oui-meeting-room__management-actions">
      <button
        class="btn btn--subtle btn--sm"
        type="button"
        ?disabled=${props.loading || props.busy}
        @click=${props.onRefresh}
      >
        ${icons.refresh}
        <span>${props.loading ? oc("Refreshing...") : oc("Refresh")}</span>
      </button>
      <button
        class="btn btn--subtle btn--sm"
        type="button"
        ?disabled=${!canInvite || !props.participantCandidates.length}
        @click=${props.onOpenInviteDialog}
      >
        ${icons.plus}
        <span>${oc("Invite agent")}</span>
      </button>
      ${!meeting
        ? html`
            <button
              class="btn primary btn--sm"
              type="button"
              ?disabled=${!canCreate}
              @click=${props.onCreateMeeting}
            >
              ${icons.plus}
              <span>${oc("Create meeting")}</span>
            </button>
          `
        : nothing}
      ${meeting
        ? html`
            <button
              class="btn btn--subtle btn--sm"
              type="button"
              ?disabled=${!canStart}
              @click=${() => props.onStartMeeting(meeting.id)}
            >
              ${icons.zap}
              <span>${oc("Start")}</span>
            </button>
            <button
              class="btn btn--subtle btn--sm"
              type="button"
              ?disabled=${!canEnd}
              @click=${() => props.onEndMeeting(meeting.id)}
            >
              ${icons.stop}
              <span>${oc("End")}</span>
            </button>
            <button
              class="btn btn--subtle btn--sm"
              type="button"
              ?disabled=${!canGenerateMinutes}
              @click=${() => props.onGenerateMinutes(meeting.id)}
            >
              ${icons.fileText}
              <span>${oc("Generate minutes")}</span>
            </button>
          `
        : nothing}
    </div>
  `;
}

function renderMeetingArtifacts(artifacts: readonly OuiArtifactRecord[]) {
  return html`
    <div class="oui-meeting-room__artifact-panel">
      <div class="oui-meeting-room__panel-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Minutes")}</div>
          <strong>${oc("Meeting notes")}</strong>
        </div>
      </div>
      ${artifacts.length
        ? repeat(
            artifacts,
            (artifact) => artifact.id,
            (artifact) => html`
              <article class="oui-meeting-room__artifact-card">
                <div class="oui-company__node-head">
                  <strong>${artifact.title}</strong>
                  ${renderStatusPill(artifact.kind, artifact.kind)}
                </div>
                <div class="oui-company__node-meta">
                  <span>${artifact.contentType}</span>
                  <span>${formatDate(artifact.updatedAt)}</span>
                </div>
                ${artifact.path ? html`<code>${artifact.path}</code>` : nothing}
              </article>
            `,
          )
        : html`<div class="oui-company__empty oui-company__empty--compact">
            ${oc("No meeting notes yet.")}
          </div>`}
    </div>
  `;
}

function renderModeratorDocumentSection(
  props: OuiMeetingRoomProps,
  meeting: OuiMeetingRecord | null,
) {
  const discussion = meeting ? meetingDiscussion(meeting) : null;
  const phaseLabel = meeting
    ? discussion?.phase === "drafting"
      ? oc("Draft")
      : discussion?.phase === "awaiting_user"
        ? oc("Awaiting user")
        : oc("Ended")
    : oc("Draft");
  const currentRound = discussion?.currentRound ?? 0;
  return html`
    <section class="oui-meeting-room__document-module">
      <div class="oui-meeting-room__panel-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Moderator")}</div>
          <strong>${oc("Moderator document")}</strong>
        </div>
        <div class="oui-meeting-room__document-meta">
          <span class="oui-company__pill oui-company__pill--active"
            >${oc("Round")} ${String(currentRound)}</span
          >
          <span class="oui-company__pill oui-company__pill--running">${phaseLabel}</span>
        </div>
      </div>
      <label class="oui-company__field">
        <span>${oc("Discussion document")}</span>
        <textarea
          class="oui-meeting-room__document-input"
          .value=${props.documentDraft}
          ?disabled=${props.busy || !meeting}
          @input=${(event: Event) =>
            props.onDocumentDraftChange((event.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
      </label>
      <div class="oui-meeting-room__document-actions">
        <button
          class="btn btn--subtle btn--sm"
          type="button"
          ?disabled=${props.busy || !meeting || !props.documentDraft.trim()}
          @click=${props.onSaveDocument}
        >
          ${icons.edit}
          <span>${oc("Save document")}</span>
        </button>
        <button
          class="btn primary btn--sm"
          type="button"
          ?disabled=${props.busy ||
          (meeting ? meeting.status === "ended" : !props.titleDraft.trim())}
          @click=${props.onRunNextRound}
        >
          ${icons.spark}
          <span>${oc(currentRound > 0 ? "Run next round" : "Start round 1")}</span>
        </button>
      </div>
    </section>
  `;
}

function renderManagementModule(
  props: OuiMeetingRoomProps,
  meeting: OuiMeetingRecord | null,
  participants: readonly OuiMeetingParticipant[],
) {
  const editable = !meeting || meeting.status !== "ended";
  return html`
    <section class="oui-company__band oui-meeting-room__management-module">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Agents")}</div>
          <h3>${oc("Agent management")}</h3>
        </div>
        ${renderMeetingManagementActions(props, meeting)}
      </div>
      ${renderModeratorDocumentSection(props, meeting)}
      <div class="oui-meeting-room__management-grid">
        ${participants.length
          ? repeat(
              participants,
              (participant) => participant.id,
              (participant, index) =>
                renderMeetingManagementCard(props, participant, index, editable),
            )
          : html`<div class="oui-company__empty">${oc("No agents invited yet.")}</div>`}
      </div>
      ${meeting ? renderMeetingArtifacts(props.artifacts) : nothing}
      ${renderInviteDialog(props, participants)}
      ${renderParticipantSettingsDialog(props, participants)}
    </section>
  `;
}

function renderMeetingDraftHeader(props: OuiMeetingRoomProps) {
  const title = props.titleDraft.trim() || oc("New meeting");
  const fallback = title.trim().slice(0, 1).toUpperCase() || "M";
  return html`
    <div class="oui-chat-window-header oui-chat-window-header--main oui-meeting-room__chat-header">
      <div class="oui-chat-window-header__identity">
        <span class="oui-chat-window-header__avatar" aria-hidden="true">
          <span class="oui-chat-window-header__avatar-text">${fallback}</span>
        </span>
        <span class="oui-chat-window-header__name" title=${title}>${title}</span>
        ${renderStatusPill("draft", "draft")}
      </div>
    </div>
  `;
}

function renderMeetingDraftChat(props: OuiMeetingRoomProps) {
  const participants = sortedParticipants(props.draftParticipants);
  return html`
    <div class="oui-meeting-room__chat-card">
      ${renderOuiChat({
        sessionKey: "oui-meeting:new",
        onSessionKeyChange: () => {},
        thinkingLevel: null,
        showThinking: false,
        showToolCalls: false,
        loading: props.loading,
        sending: props.busy,
        canAbort: false,
        compactionStatus: null,
        fallbackStatus: null,
        messages: [
          {
            id: "oui-meeting-room-setup",
            role: "assistant",
            content: oc(
              "Use the left panel for title, description, and speaking order. Manage agent cards below.",
            ),
            timestamp: Date.now(),
            senderLabel: oc("Meeting room"),
          },
        ],
        sideResult: null,
        toolMessages: [],
        streamSegments: [],
        stream: null,
        streamStartedAt: null,
        assistantAvatarUrl: null,
        draft: "",
        queue: [],
        connected: true,
        canSend: false,
        disabledReason: oc("Create the meeting first, then talk to the moderator between rounds."),
        error: props.error,
        sessions: null,
        focusMode: false,
        autoExpandToolCalls: false,
        attachments: [],
        showNewMessages: false,
        onScrollToBottom: () => {},
        onRefresh: props.onRefresh,
        onToggleFocusMode: () => {},
        getDraft: () => "",
        onDraftChange: () => {},
        onRequestUpdate: () => {},
        onSend: () => {},
        onQueueRemove: () => {},
        onNewSession: () => {},
        agentsList: {
          agents: participants.length
            ? participants.map((participant) => ({
                id: participant.id,
                name: participant.label,
                identity: { name: participant.label },
              }))
            : [
                {
                  id: "meeting-room",
                  name: oc("Meeting room"),
                  identity: { name: oc("Meeting room") },
                },
              ],
          defaultId: participants[0]?.id ?? "meeting-room",
        },
        currentAgentId: participants[0]?.id ?? "meeting-room",
        onAgentChange: () => {},
        assistantName: oc("Meeting room"),
        assistantAvatar: null,
        userName: oc("You"),
        userAvatar: null,
        topChrome: renderMeetingDraftHeader(props),
        basePath: "",
      })}
    </div>
  `;
}

function renderMeetingChatHeader(meeting: OuiMeetingRecord) {
  const fallback = meeting.title.trim().slice(0, 1).toUpperCase() || "M";
  return html`
    <div class="oui-chat-window-header oui-chat-window-header--main oui-meeting-room__chat-header">
      <div class="oui-chat-window-header__identity">
        <span class="oui-chat-window-header__avatar" aria-hidden="true">
          <span class="oui-chat-window-header__avatar-text">${fallback}</span>
        </span>
        <span class="oui-chat-window-header__name" title=${meeting.title}>${meeting.title}</span>
        ${renderStatusPill(meeting.status, meeting.status)}
      </div>
    </div>
  `;
}

function renderMeetingChat(props: OuiMeetingRoomProps, meeting: OuiMeetingRecord) {
  const canSend = !props.busy && meeting.status !== "ended" && Boolean(props.promptDraft.trim());
  const participants = sortedParticipants(meeting.participants);
  const participantAgents = participants.map((participant) => ({
    id: participant.id,
    name: participant.label,
    identity: { name: participant.label },
  }));
  const currentAgentId = participantAgents[0]?.id ?? `meeting:${meeting.id}`;
  return html`
    <div class="oui-meeting-room__chat-card">
      ${renderOuiChat({
        sessionKey: `oui-meeting:${meeting.id}`,
        onSessionKeyChange: () => {},
        thinkingLevel: null,
        showThinking: false,
        showToolCalls: false,
        loading: props.loading,
        sending: props.busy,
        canAbort: false,
        compactionStatus: null,
        fallbackStatus: null,
        messages: mapMeetingMessagesForChat(meeting, props.messages),
        sideResult: null,
        toolMessages: [],
        streamSegments: [],
        stream: null,
        streamStartedAt: null,
        assistantAvatarUrl: null,
        draft: props.promptDraft,
        queue: [],
        connected: meeting.status !== "ended",
        canSend,
        disabledReason:
          meeting.status === "ended"
            ? oc("Meeting has ended.")
            : oc("Use this box to tell the moderator what to change before the next round."),
        error: props.error,
        sessions: null,
        focusMode: false,
        autoExpandToolCalls: false,
        attachments: [],
        showNewMessages: false,
        onScrollToBottom: () => {},
        onRefresh: props.onRefresh,
        onToggleFocusMode: () => {},
        getDraft: () => props.promptDraft,
        onDraftChange: props.onPromptDraftChange,
        onRequestUpdate: () => {},
        onSend: () => {
          if (canSend) {
            void props.onReviseModeratorDocument();
          }
        },
        onQueueRemove: () => {},
        onNewSession: () => {},
        agentsList: {
          agents: participantAgents.length
            ? participantAgents
            : [
                {
                  id: currentAgentId,
                  name: oc("Meeting room"),
                  identity: { name: oc("Meeting room") },
                },
              ],
          defaultId: currentAgentId,
        },
        currentAgentId,
        onAgentChange: () => {},
        assistantName: oc("Meeting room"),
        assistantAvatar: null,
        userName: oc("You"),
        userAvatar: null,
        topChrome: renderMeetingChatHeader(meeting),
        basePath: "",
      })}
    </div>
  `;
}

function renderMeetingList(props: OuiMeetingRoomProps) {
  return html`
    <section class="oui-company__band">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Meetings")}</div>
          <h3>${oc("Meeting history")}</h3>
        </div>
      </div>
      <div class="oui-company__company-grid">
        ${props.meetings.length
          ? repeat(
              props.meetings,
              (meeting) => meeting.id,
              (meeting) => html`
                <button
                  type="button"
                  class="oui-company__company-card ${meeting.id === props.selectedMeetingId
                    ? "oui-company__company-card--selected"
                    : ""}"
                  ?disabled=${props.busy}
                  @click=${() => props.onSelectMeeting(meeting.id)}
                >
                  <div class="oui-company__company-card-head">
                    <span>${meeting.title}</span>
                    ${renderStatusPill(meeting.status, meeting.status)}
                  </div>
                  <div class="oui-company__company-objective">
                    ${meeting.objective ?? oc("No objective set.")}
                  </div>
                  <div class="oui-company__company-meta">
                    <span>${oc("Agents")}: ${String(meeting.participants.length)}</span>
                    <span>${oc("Updated")}: ${formatDate(meeting.updatedAt)}</span>
                  </div>
                </button>
              `,
            )
          : html`<div class="oui-company__empty">${oc("No meetings yet.")}</div>`}
      </div>
    </section>
  `;
}

function renderDraftMeetingView(props: OuiMeetingRoomProps) {
  const participants = sortedParticipants(props.draftParticipants);
  return html`
    <section class="oui-meeting-room__workspace">
      ${renderDraftSidebar(props)} ${renderMeetingDraftChat(props)}
    </section>
    ${renderManagementModule(props, null, participants)}
  `;
}

function renderExistingMeetingView(props: OuiMeetingRoomProps, meeting: OuiMeetingRecord) {
  const participants = sortedParticipants(meeting.participants);
  return html`
    <section class="oui-meeting-room__workspace">
      ${renderMeetingSidebar(props, meeting)} ${renderMeetingChat(props, meeting)}
    </section>
    ${renderManagementModule(props, meeting, participants)}
  `;
}

export function renderOuiMeetingRoom(props: OuiMeetingRoomProps) {
  const meeting = selectedMeeting(props);
  return html`
    <section class="oui-company oui-meeting-room">
      ${renderMessage(props)}
      ${meeting ? renderExistingMeetingView(props, meeting) : renderDraftMeetingView(props)}
      ${props.meetings.length
        ? html`<div class="oui-meeting-room__management">${renderMeetingList(props)}</div>`
        : nothing}
    </section>
  `;
}

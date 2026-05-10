import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  OuiArtifactRecord,
  OuiMeetingMessageRecord,
  OuiMeetingRecord,
} from "../../oui/shared/product-types.ts";
import type {
  OuiMeetingParticipantCandidate,
  OuiMeetingRoomMessage,
} from "../controllers/oui-meeting-room.ts";
import { icons } from "../icons.ts";
import { ouiCompanyCopy, ouiCompanyStatusLabel } from "../oui-company-copy.ts";

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
  participantDraftId: string;
  draftParticipantIds: string[];
  promptDraft: string;
  onRefresh: () => void | Promise<void>;
  onSelectMeeting: (meetingId: string) => void | Promise<void>;
  onTitleDraftChange: (next: string) => void;
  onObjectiveDraftChange: (next: string) => void;
  onParticipantDraftChange: (next: string) => void;
  onAddParticipant: () => void;
  onRemoveParticipant: (participantId: string) => void;
  onCreateMeeting: () => void | Promise<void>;
  onPromptDraftChange: (next: string) => void;
  onSendTurn: () => void | Promise<void>;
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

function renderHero(props: OuiMeetingRoomProps) {
  const activeCount = props.meetings.filter((meeting) => meeting.status === "active").length;
  const endedCount = props.meetings.filter((meeting) => meeting.status === "ended").length;
  return html`
    <section class="oui-company__hero">
      <div class="oui-company__hero-main">
        <div class="oui-company__eyebrow">OUI</div>
        <h2>${oc("Meeting room")}</h2>
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
        </div>
      </div>
      <div class="oui-company__metrics">
        <div class="oui-company__metric">
          <span>${oc("Meetings")}</span>
          <strong>${String(props.meetings.length)}</strong>
        </div>
        <div class="oui-company__metric">
          <span>${oc("Active")}</span>
          <strong>${String(activeCount)}</strong>
        </div>
        <div class="oui-company__metric">
          <span>${oc("Ended")}</span>
          <strong>${String(endedCount)}</strong>
        </div>
        <div class="oui-company__metric">
          <span>${oc("Minutes")}</span>
          <strong>${String(props.artifacts.length)}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderCreateMeeting(props: OuiMeetingRoomProps) {
  const selectedCandidateId = props.participantDraftId || props.participantCandidates[0]?.id || "";
  const draftParticipants = props.participantCandidates.filter((candidate) =>
    props.draftParticipantIds.includes(candidate.id),
  );
  return html`
    <section class="oui-company__band">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Meeting")}</div>
          <h3>${oc("Create meeting")}</h3>
        </div>
      </div>
      <div class="oui-company__company-create oui-company__meeting-create">
        <label class="oui-company__field oui-company__field--company-name">
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
          <span>${oc("Agent")}</span>
          <select
            .value=${selectedCandidateId}
            ?disabled=${props.busy || !props.participantCandidates.length}
            @change=${(event: Event) =>
              props.onParticipantDraftChange((event.currentTarget as HTMLSelectElement).value)}
          >
            ${props.participantCandidates.length
              ? props.participantCandidates.map(
                  (candidate) => html`
                    <option value=${candidate.id}>
                      ${candidate.label}${candidate.modelRef ? ` / ${candidate.modelRef}` : ""}
                    </option>
                  `,
                )
              : html`<option value="">${oc("Connect Gateway to choose agents")}</option>`}
          </select>
        </label>
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.busy || !selectedCandidateId}
          @click=${props.onAddParticipant}
        >
          ${icons.plus}
          <span>${oc("Invite")}</span>
        </button>
        <label class="oui-company__field oui-company__field--description">
          <span>${oc("Objective")}</span>
          <textarea
            .value=${props.objectiveDraft}
            ?disabled=${props.busy}
            placeholder=${oc("What should this meeting discuss?")}
            @input=${(event: Event) =>
              props.onObjectiveDraftChange((event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
        </label>
        <button
          class="btn primary oui-company__create-company-button"
          type="button"
          ?disabled=${props.busy || !props.titleDraft.trim()}
          @click=${props.onCreateMeeting}
        >
          ${icons.plus}
          <span>${oc("Create meeting")}</span>
        </button>
      </div>
      <div class="oui-company__agent-tags oui-company__meeting-draft-participants">
        ${draftParticipants.length
          ? draftParticipants.map(
              (participant) => html`
                <button
                  class="oui-company__pill oui-company__pill--active"
                  type="button"
                  ?disabled=${props.busy}
                  @click=${() => props.onRemoveParticipant(participant.id)}
                >
                  ${participant.label}
                </button>
              `,
            )
          : html`<span class="oui-company__muted">${oc("No agents invited yet.")}</span>`}
      </div>
    </section>
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

function renderSelectedMeeting(props: OuiMeetingRoomProps) {
  const meeting = selectedMeeting(props);
  if (!meeting) {
    return html`<section class="oui-company__band">
      <div class="oui-company__empty">${oc("Select or create a meeting.")}</div>
    </section>`;
  }
  const canSend = !props.busy && Boolean(props.promptDraft.trim());
  return html`
    <section class="oui-company__band">
      <div class="oui-company__section-head">
        <div>
          <div class="oui-company__eyebrow">${oc("Meeting")}</div>
          <h3>${meeting.title}</h3>
        </div>
        <div class="oui-company__section-actions">
          <button
            class="btn btn--subtle btn--sm"
            type="button"
            ?disabled=${props.busy || meeting.status !== "draft"}
            @click=${() => props.onStartMeeting(meeting.id)}
          >
            ${icons.zap}
            <span>${oc("Start")}</span>
          </button>
          <button
            class="btn btn--subtle btn--sm"
            type="button"
            ?disabled=${props.busy || meeting.status === "ended"}
            @click=${() => props.onEndMeeting(meeting.id)}
          >
            ${icons.stop}
            <span>${oc("End")}</span>
          </button>
          <button
            class="btn btn--subtle btn--sm"
            type="button"
            ?disabled=${props.busy || !props.messages.length}
            @click=${() => props.onGenerateMinutes(meeting.id)}
          >
            ${icons.fileText}
            <span>${oc("Generate minutes")}</span>
          </button>
        </div>
      </div>
      <div class="oui-company__agent-grid oui-company__meeting-participants">
        ${meeting.participants.length
          ? meeting.participants.map(
              (participant) => html`
                <article class="oui-company__agent-card">
                  <div class="oui-company__agent-avatar">
                    ${participant.label.trim().slice(0, 1).toUpperCase()}
                  </div>
                  <div class="oui-company__agent-body">
                    <div class="oui-company__agent-name">${participant.label}</div>
                    <div class="oui-company__agent-meta">
                      <span>${participant.adapterKind}</span>
                      ${participant.modelRef ? html`<span>${participant.modelRef}</span>` : nothing}
                    </div>
                  </div>
                </article>
              `,
            )
          : html`<div class="oui-company__empty">${oc("No agents invited yet.")}</div>`}
      </div>
      <div class="oui-company__ceo-chat-log oui-company__meeting-log">
        ${props.messages.length
          ? repeat(
              props.messages,
              (message) => message.id,
              (message) => {
                const participant = meeting.participants.find(
                  (entry) => entry.id === message.participantId,
                );
                const label =
                  message.role === "owner"
                    ? oc("You")
                    : (participant?.label ??
                      (message.role === "system" ? oc("System") : oc("Agent")));
                return html`
                  <article
                    class="oui-company__ceo-message oui-company__ceo-message--${message.role}"
                  >
                    <div class="oui-company__ceo-message-head">
                      <strong>${label}</strong>
                      <span>${formatDate(message.createdAt)}</span>
                    </div>
                    <p>${message.content}</p>
                  </article>
                `;
              },
            )
          : html`<div class="oui-company__empty oui-company__empty--compact">
              ${oc("No meeting messages yet.")}
            </div>`}
      </div>
      <div class="oui-company__ceo-composer">
        <textarea
          .value=${props.promptDraft}
          ?disabled=${props.busy || meeting.status === "ended"}
          placeholder=${oc("Send an agenda item to the meeting.")}
          @input=${(event: Event) =>
            props.onPromptDraftChange((event.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <button class="btn primary" type="button" ?disabled=${!canSend} @click=${props.onSendTurn}>
          ${icons.send}
          <span>${oc("Send")}</span>
        </button>
      </div>
      <div class="oui-company__artifact-list">
        ${props.artifacts.length
          ? repeat(
              props.artifacts,
              (artifact) => artifact.id,
              (artifact) => html`
                <article class="oui-company__artifact-card">
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
          : nothing}
      </div>
    </section>
  `;
}

export function renderOuiMeetingRoom(props: OuiMeetingRoomProps) {
  return html`
    <section class="oui-company oui-meeting-room">
      ${renderHero(props)} ${renderMessage(props)} ${renderCreateMeeting(props)}
      ${renderMeetingList(props)} ${renderSelectedMeeting(props)}
    </section>
  `;
}

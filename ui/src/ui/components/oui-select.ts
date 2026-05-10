import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";

export type OuiSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export class OuiSelectElement extends LitElement {
  override createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) options: OuiSelectOption[] = [];
  @property() value = "";
  @property() name = "";
  @property() placeholder = "";
  @property({ attribute: "aria-label" }) ariaLabel = "";
  @property({ type: Boolean, reflect: true }) disabled = false;

  private readonly handleDocumentPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && this.contains(event.target)) {
      return;
    }
    this.close();
  };

  override disconnectedCallback() {
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    super.disconnectedCallback();
  }

  private close() {
    this.querySelector("details")?.removeAttribute("open");
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
  }

  private readonly handleToggle = (event: Event) => {
    const details = event.currentTarget as HTMLDetailsElement;
    if (this.disabled) {
      details.removeAttribute("open");
      return;
    }
    if (details.open) {
      document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
    } else {
      document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    }
  };

  private select(value: string) {
    if (this.disabled) {
      return;
    }
    if (this.value !== value) {
      this.value = value;
      this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
    this.close();
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    }
  };

  override render() {
    const selected = this.options.find((option) => option.value === this.value);
    const label = selected?.label ?? this.placeholder;
    const ariaLabel = this.ariaLabel || this.name || this.placeholder || "Select";
    return html`
      <details class="oui-select" @toggle=${this.handleToggle} @keydown=${this.handleKeyDown}>
        <summary
          class="oui-select__button"
          role="button"
          aria-disabled=${this.disabled ? "true" : "false"}
          aria-label=${ariaLabel}
          @click=${(event: MouseEvent) => {
            if (this.disabled) {
              event.preventDefault();
            }
          }}
        >
          <span class="oui-select__value">${label}</span>
          <span class="oui-select__chevron" aria-hidden="true"></span>
        </summary>
        <div class="oui-select__menu" role="listbox" aria-label=${ariaLabel}>
          ${this.options.map(
            (option) => html`
              <button
                type="button"
                class="oui-select__option ${option.value === this.value
                  ? "oui-select__option--selected"
                  : ""}"
                role="option"
                aria-selected=${option.value === this.value ? "true" : "false"}
                ?disabled=${option.disabled}
                @click=${() => this.select(option.value)}
              >
                ${option.label}
              </button>
            `,
          )}
        </div>
      </details>
    `;
  }
}

if (!customElements.get("oui-select")) {
  customElements.define("oui-select", OuiSelectElement);
}

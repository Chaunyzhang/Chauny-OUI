import { describe, expect, it } from "vitest";
import { redactLogMessage, redactSecrets, shouldRedactKey } from "./redaction.ts";

describe("OUI redaction", () => {
  it("redacts sensitive object keys recursively", () => {
    expect(shouldRedactKey("apiKey")).toBe(true);
    expect(
      redactSecrets({
        gateway: { token: "plain-token" },
        nested: [{ password: "secret" }],
        safe: "value",
      }),
    ).toEqual({
      gateway: { token: "[REDACTED]" },
      nested: [{ password: "[REDACTED]" }],
      safe: "value",
    });
  });

  it("redacts bearer-like log text and bounds message size", () => {
    const message = redactLogMessage(
      `Authorization: Bearer abcdefghijklmnop1234567890 ${"x".repeat(200)}`,
      64,
    );

    expect(message).toContain("[REDACTED]");
    expect(message.endsWith("...[truncated]")).toBe(true);
  });
});

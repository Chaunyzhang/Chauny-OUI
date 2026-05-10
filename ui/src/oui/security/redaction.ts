const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(api[_-]?key|authorization|auth|bearer|client[_-]?secret|credential|password|refresh[_-]?token|secret|token)($|[_-])/i;
const SECRET_VALUE_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|OPEN[A-Z0-9_]*_API_KEY=[^\s"'`]+|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9._-]{16,}\.[A-Za-z0-9._-]{16,})\b/g;

const REDACTED = "[REDACTED]";

export function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function redactSecretText(value: string): string {
  return value.replace(SECRET_VALUE_PATTERN, REDACTED);
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecretText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = shouldRedactKey(key) ? REDACTED : redactSecrets(nestedValue);
  }
  return result;
}

export function redactLogMessage(message: string, maxLength = 8_000): string {
  const redacted = redactSecretText(message);
  if (redacted.length <= maxLength) {
    return redacted;
  }
  return `${redacted.slice(0, maxLength)}...[truncated]`;
}

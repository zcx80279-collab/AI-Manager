const SENSITIVE_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  { regex: /sk-[A-Za-z0-9_-]{12,}/g, replacement: '[REDACTED_OPENAI_KEY]' },
  { regex: /AIza[0-9A-Za-z_-]{20,}/g, replacement: '[REDACTED_GOOGLE_KEY]' },
  { regex: /gh[pousr]_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { regex: /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  {
    regex: /(api[_-]?key|token|secret|password|authorization|cookie)\s*[:=]\s*["']?[^\s"',;}{]+["']?/gi,
    replacement: '$1=[REDACTED]',
  },
  { regex: /[A-Za-z]:\\(?:Users|Program Files|Windows)[^\s"']*/gi, replacement: '[REDACTED_PATH]' },
  { regex: /\/(?:Users|home|var|etc|tmp)\/[^\s"']*/g, replacement: '[REDACTED_PATH]' },
];

export function maskSensitiveText(input: string): string {
  let masked = input;
  for (const { regex, replacement } of SENSITIVE_PATTERNS) {
    masked = masked.replace(regex, replacement);
  }
  return masked;
}

export function safeServerLog(scope: string, err: unknown): void {
  const raw = err instanceof Error ? err.message : String(err);
  console.error(`[AI-Control-Center][${scope}] ${maskSensitiveText(raw)}`);
}

export function sanitizeUserError(fallbackMessage: string, statusCode?: number): string {
  if (typeof statusCode === 'number') {
    return `${fallbackMessage} (HTTP ${statusCode})`;
  }
  return fallbackMessage;
}

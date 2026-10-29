/** What kind of failure — the same word on every wire the engine answers on. */
export const FAILURE_KINDS = [
  "invalid",
  "unauthenticated",
  "permission_denied",
  "not_found",
  "conflict",
  "in_progress",
  "key_reused",
  "domain",
  "exhausted",
  "unavailable",
  "unknown_outcome",
  "internal",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

/** What the caller does next — what a screen branches on instead of the text. */
export const NEXT_STEPS = [
  "fix_request",
  "authenticate",
  "ask_for_access",
  "do_not_retry",
  "refresh_and_retry",
  "retry_later",
  "verify_then_retry",
] as const;

export type NextStep = (typeof NEXT_STEPS)[number];

/** One field of the request that did not validate, addressed as a JSON pointer (`#/total`). */
export interface FieldError {
  pointer: string;
  detail: string;
}

/**
 * One failure as the engine tells it: the same members whether it came over REST (RFC 9457),
 * the framework's own REST gateway or JSON-RPC, so a screen handles a refusal once.
 *
 * Branch on `kind`, `reason` and `next_step` — never on `detail`, which is text for a person
 * and absent when nothing of the failure was the caller's to read.
 */
export interface Problem {
  kind: FailureKind;

  /** UPPER_SNAKE and stable: what a client switches on. */
  reason: string;

  title?: string;

  /** The HTTP status the kind answers with; absent over JSON-RPC, which has its own codes. */
  status?: number;

  /** What the caller may read of the failure; absent when nothing of it was the caller's. */
  detail?: string;

  next_step: NextStep;

  /** What to do next, in words — for a person or an agent reading it. */
  guidance?: string;

  /** Whether sending the same request again, as it is or after a fresh read, may succeed. */
  retryable: boolean;

  /** Seconds to wait before retrying; absent when waiting does not help. */
  retry_after?: number;

  /** The fields that did not validate — empty unless the request itself was malformed. */
  errors: FieldError[];

  /** What the error chose to disclose besides: a missing permission, a step-up, a limit. */
  extensions: Record<string, unknown>;
}

const MEMBERS: ReadonlySet<string> = new Set([
  "kind",
  "reason",
  "title",
  "status",
  "detail",
  "message",
  "next_step",
  "guidance",
  "retryable",
  "retry_after",
  "errors",
]);

/**
 * The problem an answer that failed carries, read the same from every wire, or `null` when it
 * carries none — a proxy's HTML page, an empty body, an older backend.
 *
 * Takes the body as it came (text or parsed): the RFC 9457 object itself, the gateway's
 * `{error: {...}}`, or a JSON-RPC error's `data`, whose `message` is the problem's `detail`.
 * A field error written the way the validation library writes it (`loc`, `msg`) is read into
 * the pointer every other wire already uses, so a form marks the field the same either way.
 *
 * @example
 * // simple: what a REST answer said, read from a caught error
 * const problem = readProblem(await response.text());
 * if (problem?.next_step === "fix_request") showError(problem.detail);
 *
 * @example
 * // medium: mark the fields of a form, and retry only what may succeed
 * try {
 *   await tickets.page(q);
 * } catch (error) {
 *   const problem = error instanceof RestError ? error.problem : null;
 *   for (const one of problem?.errors ?? []) markInvalid(one.pointer, one.detail);
 *   if (problem?.retryable) setTimeout(retry, (problem.retry_after ?? 1) * 1000);
 * }
 */
export function readProblem(body: unknown): Problem | null {
  const value = typeof body === "string" ? parsed(body) : body;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const written = value as Record<string, unknown>;
  if (typeof written.kind !== "string" || typeof written.reason !== "string") {
    return "error" in written ? readProblem(written.error) : null;
  }

  const detail = written.detail ?? written.message;
  const extensions: Record<string, unknown> = {};
  for (const [key, one] of Object.entries(written)) {
    if (!MEMBERS.has(key)) extensions[key] = one;
  }
  return {
    kind: written.kind as FailureKind,
    reason: written.reason,
    ...(typeof written.title === "string" ? { title: written.title } : {}),
    ...(typeof written.status === "number" ? { status: written.status } : {}),
    ...(typeof detail === "string" ? { detail } : {}),
    next_step: (typeof written.next_step === "string"
      ? written.next_step
      : "do_not_retry") as NextStep,
    ...(typeof written.guidance === "string" ? { guidance: written.guidance } : {}),
    retryable: written.retryable === true,
    ...(typeof written.retry_after === "number" ? { retry_after: written.retry_after } : {}),
    errors: Array.isArray(written.errors) ? written.errors.flatMap(fieldErrorOf) : [],
    extensions,
  };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** One field error, as a pointer — read from `{pointer, detail}` or from `{loc, msg}`. */
function fieldErrorOf(one: unknown): FieldError[] {
  if (one === null || typeof one !== "object") return [];
  const written = one as Record<string, unknown>;
  if (typeof written.pointer === "string") {
    return [{ pointer: written.pointer, detail: String(written.detail ?? "") }];
  }
  if (!Array.isArray(written.loc)) return [];
  // Where the value came from is not part of the DTO: the engine drops it, so this does too.
  const parts = written.loc.map(String);
  if (["body", "query", "path", "header", "cookie"].includes(parts[0] ?? "")) parts.shift();
  const pointer =
    "#/" + parts.map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
  return [{ pointer, detail: String(written.msg ?? "") }];
}

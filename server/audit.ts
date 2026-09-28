/**
 * Administrative audit log.
 *
 * Records security-relevant activity. NEVER stores an OAuth access
 * token, a GitHub password, a raw session token, the OAuth client
 * secret or a cookie value. Metadata is restricted to a small
 * allow-list of scalar, non-sensitive fields and is length-capped.
 */

import { randomToken } from "./crypto.ts";

export type AuditAction =
  | "login_success"
  | "login_failure"
  | "login_rejected_user"
  | "logout"
  | "session_denied"
  | "question_create"
  | "question_update"
  | "question_duplicate"
  | "question_publish"
  | "question_unpublish"
  | "question_disable"
  | "question_enable"
  | "question_delete"
  | "question_import";

export type AuditOutcome = "success" | "failure";

const SAFE_METADATA_KEYS = [
  "reason",
  "count",
  "imported",
  "skipped",
  "conflicts",
  "failed",
  "source",
  "version",
  "published",
  "enabled",
  "githubId",
  "endpoint",
  "method",
  "status",
] as const;

function sanitizeMetadata(
  metadata: Record<string, unknown> | null,
): string {
  if (metadata === null) {
    return "{}";
  }

  const safe: Record<string, string | number | boolean> = {};

  for (const key of SAFE_METADATA_KEYS) {
    const value = metadata[key];

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      safe[key] =
        typeof value === "string"
          ? value.slice(0, 200)
          : value;
    }
  }

  return JSON.stringify(safe);
}

export async function recordAudit(
  db: D1Database,
  event: {
    actorGithubId: string | null;
    actorLogin: string | null;
    action: AuditAction;
    questionId?: string | null;
    outcome?: AuditOutcome;
    metadata?: Record<string, unknown> | null;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_audit_log (
         id, actor_github_id, actor_login, action,
         question_id, outcome, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      randomToken(12),
      event.actorGithubId,
      event.actorLogin,
      event.action,
      event.questionId ?? null,
      event.outcome ?? "success",
      sanitizeMetadata(event.metadata ?? null),
      event.now,
    )
    .run();
}

export type AuditRow = {
  id: string;
  actor_github_id: string | null;
  actor_login: string | null;
  action: string;
  question_id: string | null;
  outcome: string;
  metadata_json: string;
  created_at: string;
};

export type AuditEntry = {
  id: string;
  actorGithubId: string | null;
  actorLogin: string | null;
  action: string;
  questionId: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export async function listAudit(
  db: D1Database,
  options: { limit?: number; questionId?: string | null } = {},
): Promise<AuditEntry[]> {
  const limit = Math.min(
    Math.max(options.limit ?? 50, 1),
    200,
  );

  const { results } =
    options.questionId
      ? await db
          .prepare(
            `SELECT * FROM admin_audit_log
              WHERE question_id = ?
              ORDER BY created_at DESC
              LIMIT ?`,
          )
          .bind(options.questionId, limit)
          .all<AuditRow>()
      : await db
          .prepare(
            `SELECT * FROM admin_audit_log
              ORDER BY created_at DESC
              LIMIT ?`,
          )
          .bind(limit)
          .all<AuditRow>();

  return results.map((row) => {
    let metadata: Record<string, unknown>;

    try {
      metadata = JSON.parse(
        row.metadata_json,
      ) as Record<string, unknown>;
    } catch {
      metadata = {};
    }

    return {
      id: row.id,
      actorGithubId: row.actor_github_id,
      actorLogin: row.actor_login,
      action: row.action,
      questionId: row.question_id,
      outcome: row.outcome,
      metadata,
      createdAt: row.created_at,
    };
  });
}

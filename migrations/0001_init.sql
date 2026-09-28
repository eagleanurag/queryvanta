-- QueryVanta persistent question store (Cloudflare D1)
--
-- The column set mirrors the EXACT shape of the existing
-- TypeScript model in `src/data/questions.ts`:
--
--   Question {
--     id, title, description, difficulty, questionType,
--     category, languages[], tags[], companies[], solved,
--     enabled?, database?, starterCode?, hint?, solutionCode?,
--     explanation?, validation?
--   }
--   QuestionDatabase { engine: "PostgreSQL", tables: TableDefinition[] }
--   TableDefinition  { name, columns: TableColumn[], rows: Record<string,unknown>[] }
--   TableColumn      { name, type: ColumnType, nullable? }
--   QuestionValidation { type: "result", orderMatters?, expectedResult[] }
--
-- Nested structures that have no natural column-per-field shape are
-- stored as JSON text. `solved` is deliberately NOT persisted: it is
-- per-learner browser state, not catalog data.
--
-- Parameters are always bound; no value is ever interpolated.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- questions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS questions (
  id                TEXT    PRIMARY KEY,
  title             TEXT    NOT NULL,
  description       TEXT    NOT NULL,
  difficulty        TEXT    NOT NULL
                            CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  question_type     TEXT    NOT NULL
                            CHECK (question_type IN
                              ('SQL', 'PySpark', 'Data Modeling',
                               'Data Engineering', 'Architecture')),
  category          TEXT    NOT NULL,
  languages         TEXT    NOT NULL DEFAULT '[]',
  tags              TEXT    NOT NULL DEFAULT '[]',
  companies         TEXT    NOT NULL DEFAULT '[]',
  database_json     TEXT,
  starter_code      TEXT,
  hint              TEXT,
  solution_code     TEXT,
  explanation       TEXT,
  validation_json   TEXT,

  -- Lifecycle. A question is publicly visible only when BOTH
  -- enabled = 1 AND published = 1 AND deleted_at IS NULL.
  enabled           INTEGER NOT NULL DEFAULT 1
                            CHECK (enabled IN (0, 1)),
  published         INTEGER NOT NULL DEFAULT 0
                            CHECK (published IN (0, 1)),
  deleted_at        TEXT,

  -- Provenance and concurrency.
  source            TEXT    NOT NULL DEFAULT 'admin'
                            CHECK (source IN ('builtin', 'admin', 'import')),
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  created_by        TEXT,
  updated_by        TEXT
);

-- Public discovery: only live, published rows, in a stable order.
CREATE INDEX IF NOT EXISTS idx_questions_public
  ON questions (published, enabled, deleted_at, updated_at DESC);

-- Engine filtering.
CREATE INDEX IF NOT EXISTS idx_questions_type
  ON questions (question_type, published, enabled);

-- Topic filtering.
CREATE INDEX IF NOT EXISTS idx_questions_category
  ON questions (category, published, enabled);

-- Difficulty filtering.
CREATE INDEX IF NOT EXISTS idx_questions_difficulty
  ON questions (difficulty, published, enabled);

-- Admin list ordering (most recently touched first).
CREATE INDEX IF NOT EXISTS idx_questions_updated
  ON questions (updated_at DESC);

-- Exact-timestamp and audit correlation.
CREATE INDEX IF NOT EXISTS idx_questions_created
  ON questions (created_at);

-- ---------------------------------------------------------------------------
-- admin_sessions
--
-- Opaque server-side sessions. The raw token is NEVER stored: only a
-- SHA-256 hash of it, so a database leak cannot be replayed as a
-- session. Expiry is enforced on every read.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_sessions (
  id                TEXT    PRIMARY KEY,
  admin_github_id   TEXT    NOT NULL,
  github_login      TEXT,
  github_avatar_url TEXT,
  token_hash        TEXT    NOT NULL UNIQUE,
  csrf_token        TEXT    NOT NULL,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  last_seen_at      TEXT    NOT NULL,
  expires_at        TEXT    NOT NULL,
  revoked_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_token
  ON admin_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry
  ON admin_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_actor
  ON admin_sessions (admin_github_id);

-- ---------------------------------------------------------------------------
-- oauth_transactions
--
-- Short-lived, single-use OAuth state + PKCE records. The state
-- parameter sent to GitHub is a random value; the database is keyed
-- by its SHA-256 hash so a dump does not reveal live states.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_transactions (
  state_hash        TEXT    PRIMARY KEY,
  code_verifier     TEXT    NOT NULL,
  redirect_to       TEXT    NOT NULL,
  created_at        TEXT    NOT NULL,
  expires_at        TEXT    NOT NULL,
  consumed_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth_expiry
  ON oauth_transactions (expires_at);

-- ---------------------------------------------------------------------------
-- admin_audit_log
--
-- Security-relevant administrative activity.
-- NEVER stores OAuth access tokens, GitHub passwords, raw session
-- tokens, the OAuth client secret or cookie values.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id                TEXT    PRIMARY KEY,
  actor_github_id   TEXT,
  actor_login       TEXT,
  action            TEXT    NOT NULL,
  question_id       TEXT,
  outcome           TEXT    NOT NULL DEFAULT 'success'
                            CHECK (outcome IN ('success', 'failure')),
  metadata_json     TEXT    NOT NULL DEFAULT '{}',
  created_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created
  ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON admin_audit_log (actor_github_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_question
  ON admin_audit_log (question_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action
  ON admin_audit_log (action, created_at DESC);

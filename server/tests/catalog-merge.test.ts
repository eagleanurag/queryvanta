import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeAdminCatalog,
  type ServerCatalogEntry,
} from "../../src/lib/questionCatalog.ts";

import type { Question } from "../../src/data/questions.ts";

/**
 * Merge / synchronization behaviour.
 *
 * The production bug: a question stored in D1 and returned by
 * `GET /api/admin/questions` was invisible in the refreshed admin
 * UI, because the admin list was derived from the PUBLIC
 * localStorage mirror, which only ever contains published rows.
 *
 * These tests pin the corrected rule so the regression cannot
 * return.
 */

type Q = Question;

function builtin(id: string, title = id): Q {
  return { id, title } as never;
}

function entry(
  id: string,
  published: boolean,
  enabled = true,
): ServerCatalogEntry {
  return {
    id,
    title: id,
    published,
    enabled,
  } as unknown as ServerCatalogEntry;
}

const ids = (rows: Q[]) => rows.map((row) => row.id);

describe("BUILT-IN + SERVER MERGE", () => {
  it("combines the built-in catalog with the server catalog", () => {
    const merged = mergeAdminCatalog({
      builtIn: [builtin("a"), builtin("b")],
      serverEntries: [entry("server-1", false)],
      localEntries: [],
      serverBacked: true,
    });

    assert.deepEqual(ids(merged), ["a", "b", "server-1"]);
  });

  it("includes DRAFTS from the server (the original bug)", () => {
    // A draft (published = false) MUST be visible to the admin.
    const merged = mergeAdminCatalog({
      builtIn: [builtin("a")],
      serverEntries: [entry("draft-1", false)],
      localEntries: [],
      serverBacked: true,
    });

    assert.ok(
      ids(merged).includes("draft-1"),
      "a draft must appear in the admin catalog",
    );
  });

  it("preserves every built-in question exactly", () => {
    const builtIn = [
      builtin("a", "Question A"),
      builtin("b", "Question B"),
      builtin("c", "Question C"),
    ];

    const merged = mergeAdminCatalog({
      builtIn,
      serverEntries: [entry("server-1", true)],
      localEntries: [],
      serverBacked: true,
    });

    // The first len(builtIn) entries are the untouched originals.
    assert.deepEqual(merged.slice(0, 3), builtIn);
    assert.equal(merged.length, 4);
  });

  it("lets the built-in catalog win an ID collision", () => {
    const merged = mergeAdminCatalog({
      builtIn: [builtin("shared-id", "Built-in wins")],
      serverEntries: [
        entry("shared-id", true) as ServerCatalogEntry,
      ].map((row) => ({ ...row }) as ServerCatalogEntry),
      localEntries: [],
      serverBacked: true,
    });

    const matching = merged.filter(
      (row) => row.id === "shared-id",
    );

    assert.equal(matching.length, 1, "no duplicate id");
    assert.equal(matching[0]?.title, "Built-in wins");
  });
});

describe("ID-BASED DEDUPLICATION", () => {
  it("does not duplicate when the same id appears twice in the server payload", () => {
    const merged = mergeAdminCatalog({
      builtIn: [],
      serverEntries: [
        entry("dup", true),
        entry("dup", true),
        entry("dup", false),
      ],
      localEntries: [],
      serverBacked: true,
    });

    assert.equal(
      ids(merged).filter((id) => id === "dup").length,
      1,
    );
  });

  it("does not duplicate when a server question is also mirrored locally", () => {
    // The mirror contains published rows that also exist on the
    // server. When a session is active only the server list is
    // used, so there is nothing to duplicate.
    const merged = mergeAdminCatalog({
      builtIn: [builtin("a")],
      serverEntries: [entry("published-1", true)],
      localEntries: [
        { id: "published-1", title: "published-1" } as never,
      ],
      serverBacked: true,
    });

    assert.deepEqual(ids(merged), ["a", "published-1"]);
  });

  it("produces a stable result across repeated merges", () => {
    const options = {
      builtIn: [builtin("a"), builtin("b")],
      serverEntries: [
        entry("s1", false),
        entry("s2", true),
      ],
      localEntries: [],
      serverBacked: true,
    };

    const first = ids(mergeAdminCatalog(options));
    const second = ids(mergeAdminCatalog(options));
    const third = ids(mergeAdminCatalog(options));

    assert.deepEqual(first, second);
    assert.deepEqual(second, third);
  });
});

describe("SOURCE SELECTION", () => {
  it("prefers the server catalog when a session is active", () => {
    const merged = mergeAdminCatalog({
      builtIn: [builtin("a")],
      serverEntries: [entry("from-server", false)],
      localEntries: [
        { id: "from-local", title: "from-local" } as never,
      ],
      serverBacked: true,
    });

    assert.ok(ids(merged).includes("from-server"));
    assert.ok(
      !ids(merged).includes("from-local"),
      "the local mirror must not shadow the server catalog",
    );
  });

  it("falls back to the local mirror without a session (GitHub Pages)", () => {
    const merged = mergeAdminCatalog({
      builtIn: [builtin("a")],
      serverEntries: null,
      localEntries: [
        { id: "local-only", title: "local-only" } as never,
      ],
      serverBacked: false,
    });

    assert.deepEqual(ids(merged), ["a", "local-only"]);
  });

  it("falls back to the local mirror when the server has not loaded yet", () => {
    // `serverEntries === null` means "not loaded". Showing the
    // local list keeps the page usable while the sync is in
    // flight, and the sync panel reports the state honestly.
    const merged = mergeAdminCatalog({
      builtIn: [builtin("a")],
      serverEntries: null,
      localEntries: [
        { id: "local-only", title: "local-only" } as never,
      ],
      serverBacked: true,
    });

    assert.deepEqual(ids(merged), ["a", "local-only"]);
  });
});

describe("STALE LOCAL MIRROR", () => {
  it("does not hide server data when the mirror is empty", () => {
    const merged = mergeAdminCatalog({
      builtIn: [builtin("a")],
      serverEntries: [entry("server-1", false)],
      localEntries: [],
      serverBacked: true,
    });

    assert.ok(ids(merged).includes("server-1"));
  });

  it("does not hide server data when the mirror is stale", () => {
    // A mirror that predates a server-side delete must not
    // resurrect the question, because only the server list is used.
    const merged = mergeAdminCatalog({
      builtIn: [builtin("a")],
      serverEntries: [],
      localEntries: [
        { id: "deleted-on-server", title: "gone" } as never,
      ],
      serverBacked: true,
    });

    assert.ok(
      !ids(merged).includes("deleted-on-server"),
      "a server-deleted question must not reappear from a stale mirror",
    );
  });

  it("a stale mirror cannot override a server-side title change", () => {
    const merged = mergeAdminCatalog({
      builtIn: [],
      serverEntries: [
        {
          ...entry("q1", true),
          title: "Server title",
        } as ServerCatalogEntry,
      ],
      localEntries: [
        { id: "q1", title: "Stale local title" } as never,
      ],
      serverBacked: true,
    });

    const found = merged.find((row) => row.id === "q1");

    assert.equal(found?.title, "Server title");
  });
});

describe("COUNTS", () => {
  it("35 built-in + 1 server draft = 36", () => {
    const builtIn = Array.from(
      { length: 35 },
      (_value, index) =>
        builtin(`builtin-${index}`),
    );

    const merged = mergeAdminCatalog({
      builtIn,
      serverEntries: [entry("test-prod-d1-crud-001", false)],
      localEntries: [],
      serverBacked: true,
    });

    assert.equal(merged.length, 36);
  });

  it("35 built-in + 1 published server question mirrored locally = 36", () => {
    const builtIn = Array.from(
      { length: 35 },
      (_value, index) =>
        builtin(`builtin-${index}`),
    );

    const merged = mergeAdminCatalog({
      builtIn,
      serverEntries: [entry("server-1", true)],
      localEntries: [
        { id: "server-1", title: "server-1" } as never,
      ],
      serverBacked: true,
    });

    assert.equal(
      merged.length,
      36,
      "the mirrored copy must not add a 37th row",
    );
  });
});

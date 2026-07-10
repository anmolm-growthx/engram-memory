/**
 * Tests for the audit-hardening fixes: incremental reindex of EDITED chunks,
 * archived memories staying out of associative recall, the entity-seeding
 * doc-frequency cap, derived-edge pruning on full rebuilds, LIKE-wildcard
 * escaping in source pruning, and balanced JSON-array extraction.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engram } from "../src/index.js";
import { SqliteStore } from "../src/store/sqlite-store.js";
import { extractJsonArray } from "../src/util/json.js";

test("incremental index re-embeds an EDITED chunk (content-hash comparison)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "engram-edit-"));
  const file = join(dir, "log.md");
  writeFileSync(file, "The deploy password is alpha.\n\nUnrelated second note.\n");
  const mem = new Engram({ dbPath: ":memory:" });

  await mem.indexDirectory(dir, { chunk: "paragraph" });

  // Edit the first paragraph in place — same file, same position-based id.
  writeFileSync(file, "The deploy password is bravo.\n\nUnrelated second note.\n");
  const inc = await mem.indexDirectory(dir, { chunk: "paragraph", incremental: true });
  assert.equal(inc.memories, 1, "exactly the edited chunk is re-stored");
  assert.equal(inc.skipped, 1, "the unchanged chunk is skipped");

  const hits = await mem.recall("deploy password", { k: 2 });
  assert.ok(hits.some((h) => h.content.includes("bravo")), "recall serves the edited text");
  assert.ok(!hits.some((h) => h.content.includes("alpha")), "the stale text is gone");

  mem.close();
  rmSync(dir, { recursive: true, force: true });
});

test("archived memories are excluded from associative recall (entity + activation paths)", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const idA = await mem.add({ content: "Kubernetes rollout for the payments service failed", source: "a.md" });
  const idB = await mem.add({ content: "Payments rollback procedure notes for QuizzleFrap", source: "a.md" });
  mem.buildEdges();
  // Sanity: b is reachable associatively before archiving.
  const before = await mem.recall("kubernetes rollout payments", { k: 10, associative: true });
  assert.ok(before.some((r) => r.id === idB), "precondition: b surfaces before archive");

  mem.store.setArchived([idB], true);
  const after = await mem.recall("kubernetes rollout payments", { k: 10, associative: true });
  assert.ok(!after.some((r) => r.id === idB), "archived memory stays out of associative recall");

  // Entity-seeded path: query names an entity only the archived memory carries.
  const entitySeeded = await mem.recall("QuizzleFrap status", { k: 10, associative: true });
  assert.ok(!entitySeeded.some((r) => r.id === idB), "archived memory is not entity-seeded");

  const included = await mem.recall("kubernetes rollout payments", {
    k: 10, associative: true, includeArchived: true,
  });
  assert.ok(included.some((r) => r.id === idB || r.id === idA), "includeArchived restores access");
  assert.ok(before.length >= after.length);
  mem.close();
});

test("entity seeding skips high-doc-frequency entities", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  // 10 memories share the common entity ZORPAX (> maxDocFreq of 8); one memory
  // carries the rare entity FLURBIT.
  for (let i = 0; i < 10; i++) {
    await mem.add({ content: `ZORPAX routine ping number ${i} nothing else`, source: `common-${i}.md` });
  }
  await mem.add({ content: "FLURBIT incident retro and mitigation", source: "rare.md" });
  mem.buildEdges();

  // candidatePool 0 empties the hybrid pool so entity seeding is the only
  // way anything can surface — isolating the path under test.
  const common = await mem.recallTrace("ZORPAX", { k: 10, candidatePool: 0 });
  assert.ok(
    !common.trace.seeds.some((s) => s.kind === "entity"),
    "no entity seeds for an entity tagged on more than 8 memories",
  );

  const rare = await mem.recallTrace("FLURBIT", { k: 10, candidatePool: 0 });
  assert.ok(
    rare.trace.seeds.some((s) => s.kind === "entity" && s.entity === "flurbit"),
    "rare entities still seed",
  );
  mem.close();
});

test("full edge rebuild prunes stale derived edges but preserves LLM-derived kinds", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const idA = await mem.add({ content: "alpha note", source: "a.md" });
  const idB = await mem.add({ content: "totally different beta content", source: "b.md" });
  const now = Date.now();
  // Plant a stale derived edge that no builder would derive, plus an LLM edge.
  mem.store.addEdge({ srcId: idA, dstId: idB, type: "similar", weight: 0.99, createdAt: now, updatedAt: now });
  mem.store.addEdge({ srcId: idA, dstId: idB, type: "caused", weight: 0.85, createdAt: now, updatedAt: now });

  mem.buildEdges();
  const types = mem.store.allEdges().map((e) => e.type);
  assert.ok(types.includes("caused"), "LLM-derived edge survives the rebuild");
  assert.ok(
    !mem.store.allEdges().some((e) => e.type === "similar" && e.weight === 0.99),
    "the planted stale similar edge was pruned",
  );
  mem.close();
});

test("incremental edge build (onlyIds) links a new memory without a full rebuild", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const idA = await mem.add({ content: "database migration checklist for payments", source: "log.md" });
  mem.buildEdges();
  const idB = await mem.add({ content: "payments database migration follow-up notes", source: "log.md" });
  mem.buildEdges({ onlyIds: [idB] });

  const edges = mem.store.edgesFor(idB);
  assert.ok(edges.length > 0, "the new memory gained edges");
  assert.ok(
    edges.some((e) => (e.srcId === idB && e.dstId === idA) || (e.srcId === idA && e.dstId === idB)),
    "linked to its neighbour in both directions",
  );
  // Empty onlyIds is a no-op, not a full rebuild.
  const res = mem.buildEdges({ onlyIds: [] });
  assert.equal(res.total, 0);
  mem.close();
});

test("deleteBySourcePrefix treats LIKE wildcards in the prefix literally", () => {
  const store = new SqliteStore(":memory:");
  const base = {
    content: "x", tier: null, importance: 0.5, metadata: null, contentHash: "h",
    createdAt: 1, updatedAt: 1, lastUsedAt: null, useCount: 0, archived: false,
    validAt: 1, invalidAt: null, embedding: null, embeddingModel: null, embeddingDim: null,
  };
  store.upsert({ ...base, id: "m1", source: "notes_1.md" });
  store.upsert({ ...base, id: "m2", source: "notesX1.md" });
  const removed = store.deleteBySourcePrefix("notes_1.md");
  assert.equal(removed, 1, "only the literal match is removed");
  assert.ok(store.getById("m2"), "the wildcard-lookalike source survives");
  store.close();
});

test("extractJsonArray survives stray brackets in surrounding prose", () => {
  const arr = extractJsonArray('Here are [my] tags: [{"a": 1}, {"b": "x]y"}] done');
  assert.deepEqual(arr, [{ a: 1 }, { b: "x]y" }]);
  assert.equal(extractJsonArray("no array here"), null);
  assert.equal(extractJsonArray("unbalanced [1, 2"), null);
  assert.deepEqual(extractJsonArray("nested [[1, 2], [3]] tail"), [[1, 2], [3]]);
});

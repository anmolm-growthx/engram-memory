import { test } from "node:test";
import assert from "node:assert/strict";
import { Engram } from "../src/index.js";

test("supersede: a corrected fact hides the stale one from recall", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "old", content: "the API base url is api.v1.example.com" },
    { id: "new", content: "the API base url is api.v2.example.com" },
  ]);
  mem.supersede("new", "old");

  const hits = await mem.recall("what is the API base url", { k: 10 });
  assert.ok(hits.some((h) => h.id === "new"), "corrected memory should surface");
  assert.ok(!hits.some((h) => h.id === "old"), "stale memory should be filtered out");

  // …but an explicitly historical query can still see it.
  const hist = await mem.recall("what is the API base url", { k: 10, includeSuperseded: true });
  assert.ok(hist.some((h) => h.id === "old"), "includeSuperseded re-admits the stale fact");
  mem.close();
});

test("affect: a high-arousal memory outranks an identical neutral one", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "calm", content: "the database migration finished overnight", metadata: { emotion: "neutral", emotion_intensity: 0 } },
    { id: "tense", content: "the database migration finished overnight", metadata: { emotion: "stress", emotion_intensity: 0.9 } },
  ]);
  const hits = await mem.recall("database migration finished", { k: 2 });
  assert.equal(hits[0]?.id, "tense", "the emotionally intense memory should rank first");
  assert.ok((hits[0]?.scores.emotion ?? 0) > 0, "affect should be recorded in the score trace");
  mem.close();
});

test("frequency: an often-recalled memory outranks an identical never-used one", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "fresh", content: "rotate the oauth client secret to fix logins" },
    { id: "proven", content: "rotate the oauth client secret to fix logins" },
  ]);
  mem.markUsed(["proven", "proven", "proven", "proven", "proven"]);
  const hits = await mem.recall("rotate oauth secret", { k: 2 });
  assert.equal(hits[0]?.id, "proven", "the frequently-used memory should rank first");
  mem.close();
});

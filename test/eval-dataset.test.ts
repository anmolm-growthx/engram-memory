import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Engram } from "../src/index.js";
import { evaluate, type LabeledQuery } from "../src/eval/recall-eval.js";

const here = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = join(here, "..", "eval");

async function indexedCorpus(): Promise<Engram> {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.indexDirectory(join(EVAL_DIR, "corpus"));
  // Knowledge-update: the corrected phone number supersedes the stale one.
  mem.supersede("phone-number-corrected", "phone-number-old");
  return mem;
}

function set(): LabeledQuery[] {
  return JSON.parse(readFileSync(join(EVAL_DIR, "recall-set.json"), "utf-8"));
}

test("the committed corpus scores well on the labelled recall set", async () => {
  const mem = await indexedCorpus();
  const m = await evaluate(mem, set(), { k: 5 });
  assert.equal(m.queries, 10);
  // Regression guard: offline hashing embedder + FTS. If recall drops below this,
  // a retrieval change regressed the benchmark.
  assert.ok(m.recallAtK >= 0.8, `recall@5 regressed: ${m.recallAtK.toFixed(3)}`);
  // hit@1 floor is lower: the corpus has several topically-overlapping memories
  // (two deploy notes, two dashboard notes), so the offline hashing embedder
  // often lands the right memory at rank 2. recall@k is the load-bearing metric.
  assert.ok(m.hitAt1 >= 0.5, `hit@1 regressed: ${m.hitAt1.toFixed(3)}`);
  mem.close();
});

test("knowledge-update: the corrected phone number wins, the stale one is gone", async () => {
  const mem = await indexedCorpus();
  const hits = await mem.recall("what is the contact phone number on file?", { k: 8 });
  assert.ok(hits.some((h) => h.id === "phone-number-corrected"), "corrected number should surface");
  assert.ok(!hits.some((h) => h.id === "phone-number-old"), "stale number must not surface");
  mem.close();
});

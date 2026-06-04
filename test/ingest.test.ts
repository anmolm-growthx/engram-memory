import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestDirectory, chunkContent, canonicalTier } from "../src/ingest/markdown.js";

test("chunkContent splits per strategy", () => {
  assert.equal(chunkContent("a\n\nb\n\nc", "paragraph").length, 3);
  assert.equal(chunkContent("a\n\nb", "file").length, 1);
  assert.equal(chunkContent("# H1\nx\n# H2\ny", "heading").length, 2);
});

test("ingestDirectory: frontmatter file = 1 memory, plain log = paragraphs", () => {
  const dir = mkdtempSync(join(tmpdir(), "engram-ingest-"));
  writeFileSync(
    join(dir, "fm.md"),
    `---\nname: lesson\nimportance: 7\nmetadata:\n  type: semantic\n---\nbody one paragraph only`,
  );
  writeFileSync(join(dir, "log.md"), `entry one happened\n\nentry two happened`);

  const mems = ingestDirectory(dir);
  assert.equal(mems.length, 3); // 1 + 2

  const semantic = mems.find((m) => m.tier === "semantic");
  assert.ok(semantic, "frontmatter type should map to tier");
  assert.equal(semantic?.id, "lesson");
  assert.equal(semantic?.importance, 7);

  const logChunks = mems.filter((m) => m.source === "log.md");
  assert.equal(logChunks.length, 2);
  assert.notEqual(logChunks[0]?.id, logChunks[1]?.id); // distinct chunk ids
});

test("canonicalTier maps every writer convention onto canonical tiers", () => {
  // canonical passes through
  assert.equal(canonicalTier("episodic"), "episodic");
  assert.equal(canonicalTier("SEMANTIC"), "semantic");
  // Friday's curated taxonomy → durable (protected) semantic
  assert.equal(canonicalTier("feedback"), "semantic");
  assert.equal(canonicalTier("project"), "semantic");
  assert.equal(canonicalTier("reference"), "semantic");
  // conversational / procedural synonyms
  assert.equal(canonicalTier("conversation"), "episodic");
  assert.equal(canonicalTier("runbook"), "procedural");
  // explicitly typed but unknown → durable, never transient
  assert.equal(canonicalTier("whatever"), "semantic");
  // untyped → undefined (store applies its own default)
  assert.equal(canonicalTier(null), undefined);
  assert.equal(canonicalTier(""), undefined);
});

test("ingest normalises curated frontmatter conventions + defaults importance", () => {
  const dir = mkdtempSync(join(tmpdir(), "engram-normalize-"));
  // Style A: top-level `type` (the convention ingest previously missed → tier=null)
  writeFileSync(
    join(dir, "feedback.md"),
    `---\nname: a rule\ndescription: do the thing\ntype: feedback\n---\nthe rule body`,
  );
  // Style B: nested `metadata.type` with a non-canonical label
  writeFileSync(
    join(dir, "project.md"),
    `---\nname: proj\nmetadata:\n  type: project\n---\nthe project body`,
  );

  const mems = ingestDirectory(dir);
  const fb = mems.find((m) => m.source === "feedback.md");
  const pj = mems.find((m) => m.source === "project.md");

  // Both durable types collapse to the protected `semantic` tier...
  assert.equal(fb?.tier, "semantic", "top-level type:feedback must resolve to a tier");
  assert.equal(pj?.tier, "semantic", "metadata.type:project must canonicalise");
  // ...and get the durable default salience (not the flat 0.5) when none declared.
  assert.equal(fb?.importance, 0.7);
  assert.equal(pj?.importance, 0.7);
});

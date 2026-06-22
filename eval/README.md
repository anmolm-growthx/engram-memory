# Recall eval

A small, committed benchmark so "is recall good?" is a number, not a vibe.

- **`corpus/`** — 9 markdown memories with stable ids (the frontmatter `name:`),
  spanning the query types from the research brief (§14): single-hop fact lookup,
  the multi-hop "episode + the lesson from it", a temporal **knowledge-update**
  (a phone number corrected by a newer memory), durable rules, and trivial chatter.
- **`recall-set.json`** — labelled queries: `[{ query, relevantIds }]`. Each query
  names the memory id(s) that *should* surface.

## Run it

```bash
# Index the corpus into a throwaway db, then score the labelled set.
npx tsx src/cli.ts index eval/corpus --db /tmp/engram-eval.db --fresh
npx tsx src/cli.ts eval eval/recall-set.json --db /tmp/engram-eval.db -k 5

# Associative mode (spreads activation across the graph):
npx tsx src/cli.ts eval eval/recall-set.json --db /tmp/engram-eval.db --associative -k 5

# Grid-search the fusion weights to maximise recall@k:
npx tsx src/cli.ts eval eval/recall-set.json --db /tmp/engram-eval.db --tune
```

`eval` prints `recall@k`, `MRR`, and `hit@1`. The default embedder is the offline
hashing provider; richer embeddings (`--provider openai`) lift the fuzzy/multi-hop
queries. `test/eval-dataset.test.ts` runs this corpus on every `npm test` as a
regression guard.

## Knowledge-update note

`phone-number-old` is superseded by `phone-number-corrected`. With an LLM
configured, `engram index … --llm-edges` detects the `supersedes` relation and
stamps the old memory's `invalid_at` automatically; the regression test does it
explicitly via `engram.supersede()`. Either way the "what is the contact phone
number on file?" query must return the *corrected* memory, never the stale one.

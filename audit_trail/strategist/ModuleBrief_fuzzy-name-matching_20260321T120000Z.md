# Module Brief: Fuzzy Name Matching

| Field | Value |
|-------|-------|
| **Module Name** | `fuzzy-name-matching` |
| **Purpose** | Harden the Gemini CLI `before_model` PII blinding hook against case-insensitive, partial-name, and typo variants of student names to close FERPA leakage gaps. |
| **Boundary: Owns** | (1) `NameIndex` construction from the bidirectional sidecar mapping (sorted entries, pre-compiled regexes, unique-part maps, stopword set). (2) Three-phase matching pipeline inside `blindText`: Phase 1 case-insensitive full-name regex, Phase 2 partial-name regex (>=4 chars, unique, non-stopword), Phase 3 Levenshtein fuzzy match (full-name sliding window + single-part). (3) Hand-rolled two-row iterative Levenshtein distance function. (4) Ambiguous match expansion (multi-token join with `" and "`, possessive handling). (5) `blindValue` updated to accept and forward the optional `NameIndex`. (6) All new unit tests covering Phases 1-3, edge cases, ambiguous matches, backward compatibility, and stopwords. |
| **Boundary: Consumes** | The bidirectional `mapping: Record<string, string>` from the sidecar file (loaded by `loadMapping()` in the same file). No changes to `loadMapping`, `main`, or the sidecar format. No changes to `after_model.ts`. No changes to `packages/core` or `packages/teacher`. |
| **Public Surface** | `blindText(text: string, mapping: Record<string, string>, index?: NameIndex): string` -- optional `index` param; omitting preserves exact-match legacy behavior. `blindValue(value: unknown, mapping: Record<string, string>, index?: NameIndex): unknown` -- forwards `index` to `blindText`. `buildNameIndex(mapping: Record<string, string>): NameIndex` -- exported factory; called once in `main()` before `blindValue`. `levenshtein(a: string, b: string): number` -- exported pure function (useful for testing). `NameIndex` type export (interface or type alias). |
| **External Dependencies** | None. Zero runtime dependencies. Levenshtein is hand-rolled. Vitest (devDependency, already present). |
| **Inherited Constraints** | (1) The `clients/gemini/` package has zero runtime dependencies -- no npm additions. (2) FERPA constraint: false positives (over-blinding) are acceptable; false negatives (name leakage) are not. (3) Backward compatibility: when `index` is omitted, `blindText`/`blindValue` must behave identically to current exact-match logic; all existing tests must pass unmodified. (4) Word-boundary matching must use `(?<!\w)...(?!\w)` lookaround (not `\b`) to handle apostrophe names like "O'Brien". |
| **Repo Location** | `clients/gemini/src/before_model.ts` (implementation), `clients/gemini/tests/unit/before_model.test.ts` (tests) |
| **Parallelism Hints** | The Levenshtein function is pure and self-contained -- it can be implemented and tested independently of the NameIndex or matching phases. The three matching phases are sequential by design (each operates on the prior phase's output), so they cannot be parallelized. The NameIndex builder depends on the stopword list and uniqueness logic but not on the phases themselves. Suggested packet split: (A) Levenshtein function + its unit tests, (B) NameIndex builder + Phase 1 + Phase 2 + their tests + backward-compat wiring, (C) Phase 3 fuzzy matching + ambiguous expansion + their tests + `main()` integration. A and B are independent; C depends on both. |
| **Cross-File Coupling** | `before_model.ts` and `before_model.test.ts` are tightly coupled and should be modified together within each packet. No other files in the repo are touched. |
| **Execution Mode Preference** | `Tool-Integrated` -- the requirements are fully specified with no design decisions remaining. The matching pipeline, thresholds, stopword list, and edge-case handling are all defined in the requirements doc. |
| **Definition of Done** | (1) `blindText("alice smith", mapping, index)` returns `[STUDENT_001]` (Phase 1). (2) `blindText("Alice", mapping, index)` returns `[STUDENT_001]` when "Alice" is unique and >=4 chars (Phase 2). (3) `blindText("Alicee Smith", mapping, index)` returns `[STUDENT_001]` (Phase 3 full-name fuzzy). (4) `blindText("Alce", mapping, index)` returns `[STUDENT_001]` when "Alce" is within Levenshtein threshold of unique part "Alice" (Phase 3 single-part fuzzy). (5) Ambiguous partial match expands: `blindText("alice's grades", mapping, index)` returns `[STUDENT_001] and [STUDENT_002]'s grades` when two students share first name "Alice". (6) Stopword names are not partial-matched: standalone "Mark" is not blinded when "Mark" is in the stopword list. (7) Short names (<4 chars) are not partial-matched: standalone "Bob" passes through. (8) `blindText(text, mapping)` (no index) behaves identically to current implementation. (9) All existing tests pass without modification. (10) `cd clients/gemini && npx vitest run tests/unit/before_model.test.ts` passes with all new tests green. (11) No new runtime dependencies added to `clients/gemini/package.json`. |

## Supplementary Notes

### Requirements Reference

Full requirements document: `clients/gemini/docs/FUZZY_MATCHING_REQUIREMENTS.md`

### Stopword List (from requirements)

The following words must be included in the stopword set for Phase 2/3 partial-match exclusion: "Will", "Mark", "Grace", "May", "Grant", "Chase", "Mason", "Dean", "Hunter", "Frank", "Dawn", "Page", "Lane", "Drew", "Dale", "Glen", "Cole", "Reed", "Wade".

### Levenshtein Thresholds (from requirements)

| Match Type | Name Length | Max Distance |
|------------|-------------|-------------|
| Full-name fuzzy | <= 12 chars | 2 |
| Full-name fuzzy | > 12 chars | 3 |
| Single-part fuzzy | 4-8 chars | 1 |
| Single-part fuzzy | 9+ chars | 2 |

### Integration Point

In `main()`, after `loadMapping()` returns a non-null mapping, call `buildNameIndex(mapping)` once and pass the resulting index to `blindValue(llmRequest, mapping, index)`. This is the only change to the hook's entry point logic.

### Upstream Dependency

Module 3.2 (roster pre-fetch) populates `SecureStore` at server startup, which writes the sidecar file that `loadMapping()` reads. This fuzzy matching module does not depend on Module 3.2 being complete -- it works with whatever sidecar content exists. However, roster pre-fetch ensures the sidecar is populated before the first `before_model` invocation, which makes fuzzy matching effective from the first prompt.

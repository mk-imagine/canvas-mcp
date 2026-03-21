# Execution Packets: fuzzy-name-matching

**Module:** fuzzy-name-matching
**Operating Mode:** A (Full Plan)
**Total Packets:** 4
**Automatable:** 4/4 (100% Tool-Integrated)
**Generated:** 2026-03-21T12:15:00Z

---

## Packet 1.1

| Field | Value |
|-------|-------|
| **Packet ID** | 1.1 |
| **Depends On** | none |
| **Prerequisite State** | Current `clients/gemini/src/before_model.ts` exports `blindText` and `blindValue`. Current `clients/gemini/tests/unit/before_model.test.ts` has 4 existing tests. |
| **Objective** | Add an exported `levenshtein(a: string, b: string): number` function using two-row iterative DP, with comprehensive unit tests. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `clients/gemini/src/before_model.ts`, `clients/gemini/tests/unit/before_model.test.ts` |
| **Tests** | Add `describe('levenshtein')` block with these cases: (1) identical strings: `levenshtein('alice', 'alice')` === 0. (2) single insertion: `levenshtein('alice', 'alicee')` === 1. (3) single deletion: `levenshtein('alice', 'alce')` === 1. (4) single substitution: `levenshtein('alice', 'alxce')` === 1. (5) completely different: `levenshtein('abc', 'xyz')` === 3. (6) empty vs non-empty: `levenshtein('', 'abc')` === 3, `levenshtein('abc', '')` === 3. (7) both empty: `levenshtein('', '')` === 0. (8) case sensitivity: `levenshtein('Alice', 'alice')` === 1 (function is case-sensitive; callers lowercase). |
| **Checklist** | 1. In `before_model.ts`, add `export function levenshtein(a: string, b: string): number` before the `blindText` function. Use standard two-row iterative DP: create two arrays of length `b.length + 1`, fill row 0 with 0..b.length, iterate rows for each char in `a`, compute min(deletion, insertion, substitution), swap rows. Return final value. 2. In test file, add `import { levenshtein }` to the existing import from `../../src/before_model.js`. 3. Add the `describe('levenshtein')` block with all 8 test cases listed above. Place it inside the existing top-level `describe('before_model hook')` block. 4. Do NOT modify any existing tests or the existing `blindText`/`blindValue` functions. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp/clients/gemini && npx vitest run tests/unit/before_model.test.ts` |
| **Pass Condition** | All 12 tests pass (4 existing + 8 new). Zero failures. |
| **Commit Message** | `feat(gemini): add hand-rolled Levenshtein distance function with tests` |
| **Stop / Escalate If** | The existing 4 tests fail (indicates accidental modification). The vitest config cannot resolve the import (check tsconfig/vitest config). |

---

## Packet 2.1

| Field | Value |
|-------|-------|
| **Packet ID** | 2.1 |
| **Depends On** | 1.1 |
| **Prerequisite State** | `levenshtein` is exported from `before_model.ts`. All 12 tests pass. |
| **Objective** | Add `NameIndex` type, `buildNameIndex` factory, Phase 1 case-insensitive full-name regex matching in `blindText`, update `blindValue` to forward `index`, and preserve backward compatibility when `index` is omitted. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `clients/gemini/src/before_model.ts`, `clients/gemini/tests/unit/before_model.test.ts` |
| **Tests** | Add three new describe blocks inside the top-level `describe('before_model hook')`: (A) `describe('buildNameIndex')`: (1) entries are sorted longest name first. (2) `uniqueParts` correctly maps unique parts to single-element token arrays and shared parts to multi-element arrays. (3) `stopwords` set contains all 19 required words: "Will", "Mark", "Grace", "May", "Grant", "Chase", "Mason", "Dean", "Hunter", "Frank", "Dawn", "Page", "Lane", "Drew", "Dale", "Glen", "Cole", "Reed", "Wade". (B) `describe('Phase 1 - case-insensitive full-name')`: (4) `blindText("alice smith", mapping, index)` returns `"[STUDENT_001]"`. (5) `blindText("ALICE SMITH", mapping, index)` returns `"[STUDENT_001]"`. (6) `blindText("Alice Smith and bob jones", mapping, index)` returns `"[STUDENT_001] and [STUDENT_002]"`. (7) Longest-first: with extended mapping adding `'Mary Jane Watson': '[STUDENT_010]'` and `'Jane Watson': '[STUDENT_011]'`, input `"Mary Jane Watson"` returns `"[STUDENT_010]"` not `"Mary [STUDENT_011]"`. (C) `describe('backward compatibility')`: (8) `blindText("What is Alice Smith's grade?", mapping)` (no index) returns same as before: `"What is [STUDENT_001]'s grade?"`. (9) `blindValue({ messages: [{ role: 'user', content: "Alice Smith's status?" }] }, mapping)` (no index) returns `{ messages: [{ role: 'user', content: "[STUDENT_001]'s status?" }] }`. Use the existing `mockMapping` from the test file for tests 4-6, 8-9. Create extended mappings locally within the test for test 7. |
| **Checklist** | 1. Add a helper function `function escapeRegex(s: string): string` that escapes all regex special characters in a string (use `s.replace(/[.*+?^${}()\|[\]\\]/g, '\\$&')`). Place before `buildNameIndex`. 2. Define and export `NameIndex` interface: `{ entries: Array<{ name: string; token: string; regex: RegExp; parts: string[] }>; uniqueParts: Map<string, string[]>; stopwords: Set<string>; partRegexes: Map<string, RegExp> }`. 3. Export `function buildNameIndex(mapping: Record<string, string>): NameIndex`. Implementation: (a) Filter mapping to name->token entries (keys not starting with `[STUDENT_`). (b) Create entries array, each with `name`, `token`, `regex: new RegExp('(?<!\\w)' + escapeRegex(name) + '(?!\\w)', 'gi')`, `parts: name.split(' ')`. (c) Sort entries by `name.length` descending (longest first). (d) Build `uniqueParts`: a `Map<string, string[]>` where key = lowercased part, value = array of tokens that have that part. Iterate all entries and all their parts; only include parts with length >= 4. (e) Build `stopwords`: `new Set(['will','mark','grace','may','grant','chase','mason','dean','hunter','frank','dawn','page','lane','drew','dale','glen','cole','reed','wade'])` (all lowercase). (f) Build `partRegexes`: for each key in `uniqueParts`, if the key is NOT in `stopwords`, create `new RegExp('(?<!\\w)' + escapeRegex(key) + "(?:'s)?(?!\\w)", 'gi')` and store in the map. 4. Update `blindText` signature to `export function blindText(text: string, mapping: Record<string, string>, index?: NameIndex): string`. When `index` is `undefined`, run existing `replaceAll` logic unchanged. When `index` is defined, run Phase 1: `let result = text; for (const entry of index.entries) { result = result.replace(entry.regex, entry.token); }; return result`. 5. Update `blindValue` signature to `export function blindValue(value: unknown, mapping: Record<string, string>, index?: NameIndex): unknown`. Pass `index` to `blindText(value, mapping, index)` and `blindValue(v, mapping, index)` in all recursive branches. 6. Do NOT modify any existing tests. Add new tests after the existing `describe('blindValue')` block. 7. In the test file, add `buildNameIndex` and `NameIndex` to the import. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp/clients/gemini && npx vitest run tests/unit/before_model.test.ts` |
| **Pass Condition** | All tests pass (12 existing/prior + 9 new = 21 total). Zero failures. Existing 4 tests unmodified and passing. |
| **Commit Message** | `feat(gemini): add NameIndex builder and Phase 1 case-insensitive full-name matching` |
| **Stop / Escalate If** | Existing tests fail. Regex with lookaround causes runtime error (V8 supports it, but verify). `NameIndex` type conflicts with anything in scope. |

---

## Packet 2.2

| Field | Value |
|-------|-------|
| **Packet ID** | 2.2 |
| **Depends On** | 2.1 |
| **Prerequisite State** | `NameIndex` type, `buildNameIndex`, `escapeRegex`, Phase 1 matching, and backward compat all in place. 21 tests passing. `blindText` has the Phase 1 code path when index is defined. `uniqueParts` map and `partRegexes` map exist on `NameIndex`. `stopwords` set exists. |
| **Objective** | Add Phase 2 partial-name matching to `blindText` (unique parts, stopword exclusion, length >= 4, ambiguous multi-token expansion with possessive handling). |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `clients/gemini/src/before_model.ts`, `clients/gemini/tests/unit/before_model.test.ts` |
| **Tests** | Add `describe('Phase 2 - partial name match')` block: (1) Unique first name >= 4 chars matched: Use mapping with `{'Alice Smith': '[STUDENT_001]', 'Bob Jones': '[STUDENT_002]'}` where "Alice" is unique. `blindText("Alice did well", mapping, index)` returns `"[STUDENT_001] did well"`. (2) Short part skipped: standalone `"Bob"` (3 chars) passes through. `blindText("Bob did well", mapping, index)` returns `"Bob did well"`. (3) Stopword skipped: mapping `{'Mark Johnson': '[STUDENT_003]', ...}`. `blindText("Mark did well", mapping, index)` returns `"Mark did well"`. (4) Full-name still works for stopword names: `blindText("Mark Johnson did well", mapping, index)` returns `[STUDENT_003] did well` (Phase 1 catches it). (5) Ambiguous expansion with possessive: mapping `{'Alice Smith': '[STUDENT_001]', 'Alice Jacobs': '[STUDENT_002]'}` (both share "Alice"). `blindText("alice's grades", mapping, index)` returns `"[STUDENT_001] and [STUDENT_002]'s grades"`. (6) Ambiguous expansion without possessive: `blindText("I spoke with alice today", mapping, index)` returns `"I spoke with [STUDENT_001] and [STUDENT_002] today"`. (7) Part not matched inside other words: `blindText("Malice is not Alice", mapping, index)` -- "Malice" untouched, "Alice" matched (assuming unique). (8) Unique last name matched: with `{'Alice Johnson': '[STUDENT_001]'}` and "Johnson" unique (no other Johnson in mapping), `blindText("Johnson submitted", mapping, index)` returns `"[STUDENT_001] submitted"`. (9) Possessive on single-token match: `blindText("Johnson's paper", mapping, index)` returns `"[STUDENT_001]'s paper"`. |
| **Checklist** | 1. In `blindText`, after the Phase 1 loop (when `index` is defined), add Phase 2 logic: iterate `index.partRegexes` entries. For each `[part, regex]` pair: (a) Look up `tokens = index.uniqueParts.get(part)`. (b) If `part` is in `index.stopwords`, skip (this check is belt-and-suspenders since `buildNameIndex` already excludes stopwords from `partRegexes`, but include it for safety). (c) If `tokens.length === 1`: replace using `result = result.replace(regex, (match, possessive) => tokens[0] + (possessive \|\| ''))` -- the regex already captures `('s)?` as group 1. (d) If `tokens.length > 1` (ambiguous): replace using `result = result.replace(regex, (match, possessive) => tokens.sort().join(' and ') + (possessive \|\| ''))`. Sort tokens to ensure deterministic output. 2. **Important regex note:** The `partRegexes` built in Packet 2.1 already include `(?:'s)?` in the pattern. The regex captures the possessive. Verify that the capture group is correctly indexed. If the `(?:...)` is non-capturing, switch to a capturing group `('s)?` so the replacement function can detect it. **Update `buildNameIndex`** if needed: change `(?:'s)?` to `('s)?` in the partRegex pattern so the possessive is captured as group 1. 3. Do NOT modify any existing tests. Add new test block after the Phase 1 tests. 4. For test cases requiring specific mappings (e.g., two Alices, Mark Johnson, etc.), create local `const` mappings and indexes within each test or describe block. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp/clients/gemini && npx vitest run tests/unit/before_model.test.ts` |
| **Pass Condition** | All tests pass (21 prior + 9 new = 30 total). Zero failures. |
| **Commit Message** | `feat(gemini): add Phase 2 partial-name matching with ambiguous expansion` |
| **Stop / Escalate If** | Possessive capture group indexing is wrong (test case 5 fails). The regex replacement interacts badly with Phase 1 replacements (already-blinded tokens getting re-matched). |

---

## Packet 3.1

| Field | Value |
|-------|-------|
| **Packet ID** | 3.1 |
| **Depends On** | 1.1, 2.2 |
| **Prerequisite State** | Phases 1 and 2 working in `blindText`. `levenshtein` function exported. `NameIndex` has `entries` (with `parts`), `uniqueParts`, `stopwords`. 30 tests passing. |
| **Objective** | Add Phase 3 Levenshtein fuzzy matching (full-name sliding window + single-part) to `blindText`. Update `main()` to call `buildNameIndex` and pass index to `blindValue`. Add final DoD verification tests. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `clients/gemini/src/before_model.ts`, `clients/gemini/tests/unit/before_model.test.ts` |
| **Tests** | Add two new describe blocks: (A) `describe('Phase 3 - fuzzy matching')`: (1) Full-name typo: `blindText("Alicee Smith did well", mapping, index)` returns `"[STUDENT_001] did well"` (distance 1, threshold 2 for 11-char name). (2) Full-name typo with long name: mapping `{'Christopher Reynolds': '[STUDENT_004]', ...}`, `blindText("Christpher Reyonlds is here", mapping, index)` returns `"[STUDENT_004] is here"` (distance 3, name is 22 chars, threshold 3). (3) Single-part typo (unique part): `blindText("Alce did well", mapping, index)` returns `"[STUDENT_001] did well"` (distance 1 from "Alice", threshold 1 for 5-char part). (4) Single-part over threshold: `blindText("Axyz did well", mapping, index)` returns `"Axyz did well"` (distance 3 from "Alice", exceeds threshold 1). (5) Full-name over threshold: `blindText("Xxxxx Yyyyy likes coding", mapping, index)` -- no match (distance too high from any name). (6) Fuzzy does not match stopwords: with `{'Mark Johnson': '[STUDENT_003]'}`, `blindText("Marl did well", mapping, index)` returns `"Marl did well"` ("Mark" is a stopword, single-part fuzzy skips it). (7) Fuzzy does not match short parts: `blindText("Bbb did well", mapping, index)` returns `"Bbb did well"` (3-char part, below 4-char minimum). (8) Fuzzy + possessive: `blindText("Alce's grades", mapping, index)` returns `"[STUDENT_001]'s grades"`. (B) `describe('DoD verification - full pipeline')`: (9) Pipeline through `blindValue` with nested object containing: a case-insensitive name, a partial name, and a typo -- all blinded. (10) Explicit check: `blindText(text, mapping)` (no index) returns exact-match behavior only. (11) Verify no new dependencies in package.json (this is a manual/checklist item, not a code test -- but include as a comment in the test file). |
| **Checklist** | 1. In `blindText`, after Phase 2 (when `index` is defined), add Phase 3. **Phase 3a - Full-name sliding window:** (a) Split `result` into word-like tokens, preserving their positions (start index, end index, text). Skip any token containing `[STUDENT_` (already blinded). (b) For each entry in `index.entries`, compute `n = entry.parts.length`. Slide an n-word window across the extracted words. For each window, join words with space, compare `levenshtein(windowText.toLowerCase(), entry.name.toLowerCase())` against threshold: `<= 2` if `entry.name.length <= 12`, `<= 3` if `> 12`. (c) If match: replace the span from first word's start to last word's end in `result` with `entry.token`. Track an offset delta for subsequent replacements. (d) Mark matched word positions as consumed so they are not re-used. **Phase 3b - Single-part fuzzy:** (a) Re-extract remaining words from `result` (skip tokens, skip words < 4 chars). (b) For each word, iterate unique parts from `index.uniqueParts`. Skip if part is in `index.stopwords`. Skip if part length < 4. Compute `levenshtein(word.toLowerCase(), part)`. Threshold: `<= 1` if part length 4-8, `<= 2` if >= 9. (c) If match found: check if the word in the original result has `'s` after it (possessive). If single token, replace with `token + possessive`. If multiple tokens (ambiguous), replace with `tokens.sort().join(' and ') + possessive`. (d) Apply replacement to `result` with offset tracking. 2. In `main()` function, after `const mapping = loadMapping()` and the null-check block, add: `const index = buildNameIndex(mapping)`. Change `const blindedRequest = blindValue(llmRequest, mapping)` to `const blindedRequest = blindValue(llmRequest, mapping, index)`. 3. Add the test blocks listed above. Use appropriate local mappings for each test. For the "Christopher Reynolds" test, create a local mapping. 4. Do NOT modify any existing tests. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp/clients/gemini && npx vitest run tests/unit/before_model.test.ts` |
| **Pass Condition** | All tests pass (30 prior + 10-11 new = ~40-41 total). Zero failures. All 11 DoD criteria from the module brief are satisfied. |
| **Commit Message** | `feat(gemini): add Phase 3 fuzzy matching and integrate NameIndex into main()` |
| **Stop / Escalate If** | Word position tracking produces off-by-one errors causing garbled output. Phase 3 replacements interfere with already-blinded tokens from Phases 1/2. Levenshtein threshold table produces unexpected matches (false positives on common English words). Performance concern: if the test mapping is very large, fuzzy matching loop is noticeable (unlikely with test-size mappings, but flag if observed). |

---

## Dependency Graph

```
Packet 1.1 (levenshtein)
    |
    v
Packet 2.1 (NameIndex + Phase 1 + backward compat)
    |
    v
Packet 2.2 (Phase 2 partial match + ambiguous expansion)
    |
    v
Packet 3.1 (Phase 3 fuzzy + main() integration + DoD verification)
```

Packets 1.1 and 2.1 are listed as sequential (2.1 depends on 1.1) because the brief's parallelism hint suggested A and B could be independent, but in practice they modify the same two files and concurrent edits would conflict. Sequential execution avoids merge conflicts.

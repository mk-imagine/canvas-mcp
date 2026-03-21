# Fuzzy Name Matching — Requirements

## Problem

The `before_model` hook blinds student real names to `[STUDENT_NNN]` tokens before prompts reach the model. The current implementation uses exact string matching (`replaceAll`), which fails when the user types names with:

- Wrong casing: `"alice smith"` instead of `"Alice Smith"`
- Typos: `"Alicee Smith"`, `"Alice Smtih"`
- Partial names: `"Alice"` instead of `"Alice Smith"`

This causes real student names to leak through to the model unblinded, violating FERPA compliance.

## Constraint

**Student PII must never reach the model unblinded.** When in doubt, blind more aggressively — false positives (over-blinding) are acceptable; false negatives (name leakage) are not.

## Scope

- **In scope:** `blindText` in `clients/gemini/src/before_model.ts` (name → token direction)
- **Out of scope:** `after_model.ts` (token → name direction) — LLM output is consistent enough that exact matching suffices

## Matching Pipeline

Matching proceeds in three phases, applied in order. Each phase operates on the result of the previous, so tokens introduced by earlier phases are not re-matched (brackets are non-word characters and naturally excluded by word-boundary patterns).

### Phase 1 — Case-insensitive exact full-name match

- For each known name in the mapping, replace all occurrences using a case-insensitive regex with word boundaries.
- Process longest names first to prevent partial overlaps (e.g., "Mary Jane Watson" before "Jane Watson").
- Example: `"alice smith"` → `[STUDENT_001]`

### Phase 2 — Partial name match (first name or last name alone)

- Match a standalone first or last name if:
  1. The name part has **4 or more characters** (short parts like "Bob", "Li", "Jo" are too common in English to safely match alone).
  2. The name part is **unique across the entire roster** (if two students share the first name "Alice", do not partial-match "Alice" alone).
  3. The name part is **not a stopword** — common English words that are also names (e.g., "Will", "Mark", "Grace", "May", "Grant", "Chase", "Mason", "Dean", "Hunter", "Frank", "Dawn", "Page", "Lane", "Drew", "Dale", "Glen", "Cole", "Reed", "Wade").
- Word-boundary regex prevents matching inside other words (e.g., "Alice" won't match inside "Malice").
- When a partial name matches **multiple students**, expand to all matching tokens joined with `" and "` (see [Ambiguous Match Handling](#ambiguous-match-handling)).

### Phase 3 — Fuzzy match (Levenshtein edit distance)

- After Phases 1 and 2, extract remaining words from the text and compare against known names using Levenshtein distance.
- **Full-name fuzzy:** Slide N-word windows across the text (where N = number of parts in a name). Compare the lowercased joined window against lowercased full names. Threshold: distance ≤ 2 for names ≤ 12 chars, ≤ 3 for longer.
- **Single-part fuzzy:** Compare individual words (length ≥ 4) against unique name parts only. Threshold: distance ≤ 1 for parts 4–8 chars, ≤ 2 for 9+ chars.
- Zero external dependencies — use a standard two-row iterative Levenshtein implementation.

## Ambiguous Match Handling

When a partial or fuzzy match resolves to **multiple students** (e.g., "Alice" matches both "Alice Jones" and "Alice Jacobs"), **expand to all matching tokens**:

```
Input:  "Can you get me alice's grades"
Output: "Can you get me [STUDENT_001] and [STUDENT_002]'s grades"
```

Rules:
- Join all matching tokens with `" and "`.
- Handle possessives: if the original text has `"alice's"`, produce `"[STUDENT_001] and [STUDENT_002]'s"` (possessive attaches to the final token only, not duplicated).
- No cap on the number of expanded matches. In practice, more than 2–3 matches for a single partial name is unlikely; if it occurs, the model can ask the user for clarification.

## Precomputed Name Index

Build a `NameIndex` once per hook invocation (not per string), containing:
- All name entries sorted longest-first
- Pre-compiled regexes for each full name and name part
- Maps of unique first names and unique last names (for Phase 2/3 eligibility)

Pass the index through `blindValue` → `blindText` to avoid repeated index construction.

## Edge Cases

| Case | Handling |
|------|----------|
| **Possessives** (`"alice's"`) | Word boundary before `'` works naturally; possessive preserved after token |
| **Apostrophe names** (`"O'Brien"`) | Use lookahead/lookbehind (`(?<!\w)...(?!\w)`) instead of `\b` for names containing non-word characters |
| **Names that are stopwords** (`"Will Hunter"`) | Full-name match (Phase 1) still works; only partial/fuzzy on "Will" alone is blocked |
| **Short names** (`"Bob Jones"`) | Full-name match and full-name fuzzy work; only standalone "Bob" partial match is skipped |
| **Overlapping names** (`"Jane Watson"` and `"Mary Jane Watson"`) | Longest-first ordering ensures "Mary Jane Watson" matches before "Jane Watson" |
| **Already-blinded tokens** | `[STUDENT_NNN]` contains non-word chars, so word-boundary regexes naturally skip them |

## Backward Compatibility

The `index` parameter on `blindText` and `blindValue` is optional. When omitted, the original exact `replaceAll` behavior is preserved. Existing tests continue to pass without modification.

## Performance

For a 200-student roster and a prompt with ~500 words:
- Phase 1/2: ~200 regex replacements — negligible (V8 native regex)
- Phase 3: ~100K Levenshtein comparisons on 5–8 char strings — well under 1ms

## Verification

All new behavior is covered by unit tests in `clients/gemini/tests/unit/before_model.test.ts`. Run:

```bash
cd clients/gemini && npx vitest run tests/unit/before_model.test.ts
```

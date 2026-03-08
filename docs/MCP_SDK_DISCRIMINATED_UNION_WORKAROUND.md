# MCP SDK Bug: Discriminated Union Schemas Silently Dropped

## Summary

`z.discriminatedUnion()` schemas passed to `server.registerTool()` are silently replaced
with an empty `{}` schema by the MCP SDK. This means the AI has no visibility into the
tool's actual parameters — it sees a tool with no inputs.

**GitHub issue:** https://github.com/modelcontextprotocol/typescript-sdk/issues/1643
**Related issue:** https://github.com/modelcontextprotocol/typescript-sdk/issues/1585
**SDK version where confirmed:** `@modelcontextprotocol/sdk` 1.27.0, `zod` 4.3.6
**Pre-fix snapshot:** git commit `0ae3e39`

## Root Cause

In `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`:

```js
inputSchema: (() => {
    const obj = normalizeObjectSchema(tool.inputSchema);
    return obj
        ? toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: 'input' })
        : EMPTY_OBJECT_JSON_SCHEMA;  // ← silently falls back here
})()
```

`normalizeObjectSchema()` in `zod-compat.js` only passes through schemas where
`_zod.def.type === 'object'`. For `z.discriminatedUnion()`, `def.type === 'union'`,
so it returns `undefined`, triggering the fallback to `EMPTY_OBJECT_JSON_SCHEMA`.

```js
export function normalizeObjectSchema(schema) {
    if (isZ4Schema(schema)) {
        const def = v4Schema._zod?.def;
        if (def && (def.type === 'object' || def.shape !== undefined)) {
            return schema;  // only objects pass through
        }
    }
    return undefined;  // discriminatedUnion hits here
}
```

Notably, `toJsonSchemaCompat()` would handle discriminated unions correctly (producing
`oneOf` output via `z4mini.toJSONSchema()`), but it is never called for them.

## Confirmed Affected Tools (pre-fix)

Tools whose schemas serialized as empty `{}` before the workaround:

| Tool | Discriminator | Variants |
|------|--------------|---------|
| `find_item` | `type` | page, assignment, quiz, module, module_item, discussion, announcement, syllabus |
| `update_item` | `type` | page, assignment, quiz, module, module_item, syllabus |
| `delete_item` | `type` | page, assignment, quiz, module, module_item, discussion, announcement |
| `create_item` | `type` | page, assignment, quiz, discussion, announcement, module, module_item |
| `list_items` | `type` | modules, assignments, quizzes, pages, discussions, announcements, rubrics, assignment_groups, module_items |
| `get_grades` | `scope` | class, assignment, student |
| `student_pii` | `action` | resolve, list |
| `build_module` | `template` | lesson, solution, clone |

## Workaround Applied

All 8 affected tools were refactored from `z.discriminatedUnion()` to flat `z.object()`
with:

1. The discriminator field changed from `z.literal('value')` to `z.enum([...all values...])`
2. All type-specific fields made optional with `describe()` strings noting which `type`/`scope`/`template` they apply to and whether they're required for that variant
3. Non-null assertions (`!`) added in handlers where previously-required fields are now `T | undefined`

### Example (get_grades)

Before:
```typescript
inputSchema: z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('class'), sort_by: z.enum([...]).optional(), ... }),
  z.object({ scope: z.literal('assignment'), assignment_id: z.number().int().positive(), ... }),
  z.object({ scope: z.literal('student'), student_token: z.string(), ... }),
]),
```

After:
```typescript
inputSchema: z.object({
  scope: z.enum(['class', 'assignment', 'student'])
    .describe('Scope: "class" (all students), "assignment" (one assignment), "student" (one student\'s history).'),
  sort_by: z.enum(['name', 'engagement', 'grade', 'zeros']).optional()
    .describe('For scope="class": sort order...'),
  assignment_id: z.number().int().positive().optional()
    .describe('For scope="assignment": Canvas assignment ID (required).'),
  student_token: z.string().optional()
    .describe('For scope="student": session token (required).'),
  course_id: z.number().int().positive().optional()
    .describe('Canvas course ID. Defaults to active course.'),
}),
```

## Reverting the Workaround

When the MCP SDK fixes `normalizeObjectSchema()` to handle discriminated unions:

1. Check out git commit `0ae3e39` to see the original discriminated union schemas
2. Restore `z.discriminatedUnion()` in these files:
   - `packages/teacher/src/tools/find.ts` (5 schemas)
   - `packages/teacher/src/tools/reporting.ts` (2 schemas)
   - `packages/teacher/src/tools/modules.ts` (1 schema)
3. Remove the `!` non-null assertions added to handler code in those files
4. Run `npm run build && npm run test:unit` to verify

## Token Impact

Confirmed via `npm run count-tokens` (Anthropic `count_tokens` API):

- **Before fix:** 9 tools serialized as empty `{}` → total MCP overhead was understated
- **After fix:** All 18 tools transmit full schemas → accurate token overhead measurement

Run `npm run count-tokens` (requires `ANTHROPIC_API_KEY`) or `npm run count-tokens -- --no-api`
for a character-count estimate to see the updated overhead after this change.

# Gemini CLI Local Patch: Preserve non-text parts in `fromHookLLMRequest`

> **Upstream PR:** [google-gemini/gemini-cli#23340](https://github.com/google-gemini/gemini-cli/pull/23340)
> Re-apply after every `npm install -g @google/gemini-cli` update until the PR is merged.

## Problem

Gemini CLI v0.34.0's `hookTranslator.js` has a bug in `fromHookLLMRequest`: when a `BeforeModel` hook returns a modified `llm_request`, the method creates brand-new text-only `Content` objects, **destroying all non-text parts** (`functionCall`, `functionResponse`, `inlineData`, `thought`, etc.) from the original request.

This breaks the canvas-mcp `before_model` hook. When the hook blinds a student name in the user's prompt, the modified `llm_request` it returns has all tool call/response history stripped. The model never sees prior tool results and re-invokes the same tool — causing an **infinite loop**.

Queries that don't trigger blinding (e.g., class-level reports where no student name appears) work correctly because the hook returns `{}` (no-op), preserving the original request.

## Target file

```
~/.local/share/fnm/node-versions/v24.14.0/installation/lib/node_modules/
  @google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/hooks/hookTranslator.js
```

Adjust the path if your Node.js is installed elsewhere (e.g., `/usr/local/lib/node_modules/` for a global npm install, or the Homebrew prefix).

## How to apply

Find the `fromHookLLMRequest` method (around line 117) and replace it. The original code creates new `contents` from hook messages only:

```javascript
// BEFORE (buggy) — lines 117-149
fromHookLLMRequest(hookRequest, baseRequest) {
    const contents = hookRequest.messages.map((message) => ({
        role: message.role === 'model' ? 'model' : message.role,
        parts: [{ text: typeof message.content === 'string'
            ? message.content : String(message.content) }],
    }));
    const result = { ...baseRequest, model: hookRequest.model, contents };
    // ... config handling ...
    return result;
}
```

Replace with the patched version that merges hook text back into the original contents, preserving non-text parts:

```javascript
// AFTER (fixed)
fromHookLLMRequest(hookRequest, baseRequest) {
    let contents;
    if (baseRequest?.contents) {
        // Merge hook messages back into base contents, preserving non-text parts
        const baseContents = Array.isArray(baseRequest.contents)
            ? baseRequest.contents
            : [baseRequest.contents];
        let messageIndex = 0;
        contents = baseContents.map((content) => {
            if (typeof content === 'string') {
                // String content always contributed a message
                if (messageIndex < hookRequest.messages.length) {
                    const message = hookRequest.messages[messageIndex++];
                    return typeof message.content === 'string'
                        ? message.content
                        : String(message.content);
                }
                return content;
            }
            if (!isContentWithParts(content)) {
                return content;
            }
            const parts = Array.isArray(content.parts)
                ? content.parts
                : [content.parts];
            const hasText = parts.some(hasTextProperty);
            if (!hasText) {
                // This content was skipped by toHookLLMRequest — preserve as-is
                return content;
            }
            // This content contributed a message — merge the hook text back in
            if (messageIndex < hookRequest.messages.length) {
                const message = hookRequest.messages[messageIndex++];
                const newText = typeof message.content === 'string'
                    ? message.content
                    : String(message.content);
                // Separate non-text parts to preserve them
                const nonTextParts = parts.filter((p) => !hasTextProperty(p));
                return {
                    ...content,
                    role: message.role === 'model' ? 'model' : message.role,
                    parts: [{ text: newText }, ...nonTextParts],
                };
            }
            return content;
        });
        // Append any remaining hook messages beyond base contents
        while (messageIndex < hookRequest.messages.length) {
            const message = hookRequest.messages[messageIndex++];
            contents.push({
                role: message.role === 'model' ? 'model' : message.role,
                parts: [{
                    text: typeof message.content === 'string'
                        ? message.content
                        : String(message.content),
                }],
            });
        }
    }
    else {
        // No baseRequest — fall back to current behavior (text-only)
        contents = hookRequest.messages.map((message) => ({
            role: message.role === 'model' ? 'model' : message.role,
            parts: [
                {
                    text: typeof message.content === 'string'
                        ? message.content
                        : String(message.content),
                },
            ],
        }));
    }
    // Build the result with proper typing
    const result = {
        ...baseRequest,
        model: hookRequest.model,
        contents,
    };
    // ... (keep the existing config handling code that follows)
```

## How it works

`toHookLLMRequest` converts SDK contents to text-only hook messages, skipping entries with no text (e.g., pure `functionCall` or `functionResponse`). The patched `fromHookLLMRequest` reverses this mapping:

1. Walk `baseRequest.contents` in order with a cursor into `hookRequest.messages`
2. Content with text parts → consume the next hook message, update text, **preserve non-text parts** (functionCall, functionResponse, etc.)
3. Content without text parts → preserve as-is in original position, don't advance cursor
4. Extra hook messages beyond base contents → append as text-only (new messages added by hook)
5. No `baseRequest` → fall back to original behavior (fully backwards-compatible)

## Verification

After patching:

```bash
# Rebuild the hooks (if you haven't already)
cd /path/to/canvas-mcp/clients/gemini && npm run build

# In Gemini CLI, test both paths:
# 1. Student-specific query (triggers blinding → exercises the patch)
> can you get student1's grades?

# 2. Class-level query (no blinding needed → no-op path, should still work)
> give me a report of all under-engaged students
```

If the patch is applied correctly, student-specific queries will return results without looping. Enable debug logging (`CANVAS_MCP_DEBUG=1` prefix on hook commands in `~/.gemini/settings.json`) and check `~/.cache/canvas-mcp/hook-debug.log` to confirm `before_model` shows `CHANGED: true` and the model receives tool results.

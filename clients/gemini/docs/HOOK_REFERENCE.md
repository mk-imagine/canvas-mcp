# Gemini CLI Response Object & Hook Behavior Analysis

## Overview
This document outlines the structure of the response object received by the `AfterModel` hook in the `gemini-cli` environment and documents critical behaviors regarding data duplication and streaming artifacts.

## 1. Response Object Structure
The `gemini-cli` passes a JSON object to the hook's standard input. The core component is the `llm_response` object, which contains the model's output.

**Critical Finding:** The model's text output is provided in **two distinct locations** within the same payload.

### Full Schema
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Gemini CLI Hook Input Schema",
  "description": "Schema representing the JSON object passed to Gemini CLI hooks (e.g., AfterModel) via stdin.",
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "The unique identifier (UUID) for the current chat session."
    },
    "transcript_path": {
      "type": "string",
      "description": "The absolute file path to the JSON log file storing the conversation history for this session."
    },
    "cwd": {
      "type": "string",
      "description": "The current working directory from which the Gemini CLI was executed."
    },
    "hook_event_name": {
      "type": "string",
      "enum": ["BeforeModel", "AfterModel", "AfterTool"],
      "description": "The name of the event that triggered this hook execution."
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "The ISO 8601 timestamp indicating when the hook event occurred."
    },
    "llm_request": {
      "type": "object",
      "description": "The complete request payload sent to the LLM, including configuration and message history.",
      "properties": {
        "model": {
          "type": "string",
          "description": "The identifier of the model being used (e.g., 'gemini-3-flash-preview')."
        },
        "messages": {
          "type": "array",
          "description": "The array of message objects representing the conversation history sent to the model.",
          "items": {
            "type": "object",
            "properties": {
              "role": {
                "type": "string",
                "enum": ["user", "model", "system"],
                "description": "The role of the message sender."
              },
              "content": {
                "type": "string",
                "description": "The actual text content of the message."
              }
            }
          }
        },
        "config": {
          "type": "object",
          "description": "Configuration parameters controlling the model's generation behavior.",
          "properties": {
            "temperature": {
              "type": "number",
              "description": "Controls the randomness of the output."
            },
            "topP": {
              "type": "number",
              "description": "Nucleus sampling parameter."
            },
            "topK": {
              "type": "number",
              "description": "Top-k sampling parameter."
            }
          }
        }
      }
    },
    "llm_response": {
      "type": "object",
      "description": "The response payload received from the model. Contains the generated text and metadata.",
      "properties": {
        "text": {
          "type": "string",
          "description": "The flat text content of the model's response chunk. IMPORTANT: This field is often a duplicate of the content found in `candidates[0].content.parts[0]`. Hooks must modify this field to ensure data consistency."
        },
        "candidates": {
          "type": "array",
          "description": "A list of generation candidates. The CLI typically uses this structure to render output to the terminal.",
          "items": {
            "type": "object",
            "properties": {
              "content": {
                "type": "object",
                "properties": {
                  "role": {
                    "type": "string",
                    "description": "The role associated with the generated content (usually 'model')."
                  },
                  "parts": {
                    "type": "array",
                    "description": "An array of content parts. IMPORTANT: This contains the text actually displayed to the user. Hooks must modify strings within this array to affect the CLI output.",
                    "items": {
                      "type": "string"
                    }
                  }
                }
              },
              "finishReason": {
                "type": "string",
                "description": "The reason why generation stopped (e.g., 'STOP', 'LENGTH')."
              }
            }
          }
        },
        "usageMetadata": {
          "type": "object",
          "description": "Statistics regarding token usage for the request and response.",
          "properties": {
            "promptTokenCount": {
              "type": "number",
              "description": "The number of tokens in the input prompt."
            },
            "candidatesTokenCount": {
              "type": "number",
              "description": "The number of tokens in the generated response."
            },
            "totalTokenCount": {
              "type": "number",
              "description": "The total number of tokens used."
            }
          }
        }
      }
    }
  },
  "required": [
    "session_id",
    "hook_event_name",
    "timestamp",
    "llm_request",
    "llm_response"
  ]
}
```

- `llm_response.text`: A top-level string containing the response chunk.
- `llm_response.candidates[0].content.parts[0]`: A nested string containing the exact same response chunk.
  - This is the text that is actually displayed in the chat window.

## 2. Behavioral Findings

### A. The "Double-Healing" Requirement
Because the text exists in two places, any modification logic (such as PII unblinding) must apply to **both** fields.
* **Observation:** The CLI appears to use the `candidates` array for rendering to the user's terminal, while the `text` field might be used for internal history or logging.
* **Failure Mode:** If the hook logic "consumes" a shared resource (like a partial token buffer) after fixing the first field (`text`), the second field (`candidates`) remains unmodified. This results in the user seeing "broken" text (e.g., `4]`) even though the logs show a successful replacement occurred.
* **Solution:** Hook logic must be stateless within a single execution turn, applying fixes to *all* string occurrences found in the object.

### B. Streaming & Token Splitting
The CLI streams responses in small chunks. This frequently results in "Split Tokens," where a semantic unit (like a PII token) is cut across two chunk boundaries.

* **Example:** `[STUDENT_001]` might be split into:
    * **Chunk N:** `...[STUD`
    * **Chunk N+1:** `ENT_001]...`
* **Implication:** Simple search-and-replace (Regex) fails because neither chunk contains the full token.
* **Required Logic:** A **Stateful Buffer** is required to persist the trailing partial characters of Chunk N and prepend them to Chunk N+1.

### C. Multi-Field Buffering
When a split token occurs, the partial fragment (e.g., `[STUD`) appears at the end of **both** the `text` field and the `candidates` field in Chunk N.
* **Next Turn:** In Chunk N+1, the buffer must be prepended to **both** fields to ensure both form valid tokens (`[STUDENT_001]`) and can be unblinded correctly.

### D. BeforeModel Hook Destroys Non-Text Parts (Gemini CLI Bug)

> **Status:** Local patch required. Upstream fix: [google-gemini/gemini-cli#23340](https://github.com/google-gemini/gemini-cli/pull/23340)

The Gemini CLI hook API uses a "stable, SDK-agnostic" request format for `BeforeModel` hooks. The `llm_request.messages` array contains **text-only** content — `functionCall`, `functionResponse`, `inlineData`, `thought`, and all other non-text parts are intentionally filtered out by `toHookLLMRequest` (documented design for a simplified hook interface).

**The bug:** When a hook returns a modified `llm_request`, `fromHookLLMRequest` creates brand-new `Content` objects from the text-only messages, **completely replacing** the original SDK contents. All non-text parts are destroyed.

**Impact on canvas-mcp:** The `before_model` hook blinds student names in the conversation. When it returns a modified `llm_request` (because a name was found and replaced), all `functionCall`/`functionResponse` parts are stripped. The model never sees prior tool results and re-invokes the same tool — infinite loop.

**Why class-level queries work:** Queries like "give me a report of all under-engaged students" don't contain student names, so `before_model` returns `{}` (no-op). The original SDK request with all parts is preserved unchanged.

**Why student-specific queries loop:** Queries like "can you get student1's grades?" contain a student name. `before_model` blinds it and returns a modified `llm_request`. On the second model call, the stored conversation history still has the original name (modifications don't persist to history), so `before_model` blinds again, destroying the tool history again — loop.

**The fix:** Patch `fromHookLLMRequest` to merge hook text changes back into the original `baseRequest.contents` instead of replacing them. See [patches/gemini-cli-hookTranslator.patch.md](patches/gemini-cli-hookTranslator.patch.md).

#### Evidence from debug logs

With `CANVAS_MCP_DEBUG=1` enabled, the debug log at `~/.cache/canvas-mcp/hook-debug.log` shows:

1. `after_tool` correctly receives the full tool response with blinded data
2. `before_model` receives the conversation with the original student name (text-only — no tool calls visible in messages)
3. `before_model` returns modified `llm_request` (`CHANGED: true`)
4. On the next model call, the conversation again has the original name but tool history is gone — the model calls the tool again

#### Debug logging

All three hooks support debug logging via the `CANVAS_MCP_DEBUG=1` environment variable. Add it as a prefix to hook commands in `~/.gemini/settings.json`:

```json
"command": "CANVAS_MCP_DEBUG=1 node /path/to/canvas-mcp/clients/gemini/dist/before_model.js"
```

Logs are written to `~/.cache/canvas-mcp/hook-debug.log` and include timestamped entries for:
- `before_model`: `INPUT_KEYS`, `LLM_REQUEST`, `CHANGED`, `OUTPUT`
- `after_model`: `INPUT_KEYS`, `LLM_RESPONSE`, `CHANGED`, `UNBLINDED_RESPONSE`, `OUTPUT`
- `after_tool`: `TOOL_CALL`, `TOOL_INPUT`, `TOOL_RESPONSE`, `SUMMARY`
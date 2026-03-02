# FERPA Compliance and PII Blinding

## Overview
The Family Educational Rights and Privacy Act (FERPA) is a federal law that affords parents the right to have access to their children's education records, the right to seek to have the records amended, and the right to have some control over the disclosure of personally identifiable information (PII) from the education records.

When using AI assistants (like Claude or Gemini) to process student data, it is critical to ensure that PII is not exposed to the AI model's training data or processed in a way that violates institutional privacy policies.

## PII Blinding Strategy
`canvas-teacher-mcp` implements a **PII Blinding** strategy to protect student identities. This ensures that the AI assistant only sees opaque tokens instead of real student names or Canvas IDs.

### How it Works
1.  **Tokenization:** When fetching student-related data (grades, submissions, etc.), the server intercepts the response.
2.  **Mapping:** Real student names and IDs are mapped to session-specific tokens like `[STUDENT_001]`, `[STUDENT_002]`.
3.  **Redaction:** The data sent to the AI assistant contains only these tokens.
4.  **Local Resolution:** The mapping between tokens and real identities is stored exclusively in the local server's memory (RAM) and is never sent to the AI provider.
5.  **User Reveal:** The instructor can see the real names in the local terminal/client UI, but the AI remains "blind" to the student's actual identity.

## Legal Justification
By blinding PII before it leaves the local environment:
- **No Disclosure:** No "personally identifiable information" is disclosed to the AI provider, as the tokens themselves carry no inherent identity.
- **De-identification:** The data provided to the AI is effectively de-identified according to FERPA standards, allowing for aggregate analysis, report generation, and grading assistance without risking student privacy.
- **Security of Records:** The "Source of Truth" remains the Canvas LMS, and the temporary mapping in the MCP server is ephemeral and encrypted.

## Best Practices for Instructors
- **Session Disposal:** The blinding map is cleared when the server restarts or the session ends.
- **Verification:** Always use the `resolve_student` tool to confirm a student's identity locally before taking action based on AI-generated insights.
- **Minimal Exposure:** Only use the tools necessary for the specific task to minimize the amount of data processed.

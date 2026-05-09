## 2025-05-14 - [Redundant Context Generation in Tool Loops]
**Learning:** In agentic workflows with tool use, context generation logic (like `getFullPrompt`) should be hoisted outside the tool iteration loop. Re-generating the full system prompt on every iteration is expensive and often redundant since tools usually only update the conversation history, which is handled separately via the messages array.
**Action:** Always check if system prompts are being re-generated inside loops during multi-step AI interactions and hoist them where possible.

## 2025-05-14 - [Dead-weight Database Fetches]
**Learning:** Found a redundant `episodic_memory` fetch in `buildContext` that was already documented as unused but still consuming resources. "Passive" technical debt like this can accumulate and slow down every request.
**Action:** Audit core service functions for unused database queries, even if they are part of a `Promise.all` block.

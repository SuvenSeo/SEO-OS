## 2025-05-14 - Parallelize Knowledge Retrieval in Context Builder

**Learning:** Discovered a sequential bottleneck in the `buildContext` service. The function was fetching core data (tasks, memory, patterns) via `Promise.all`, but then waiting for those to complete before initiating `fetchRelevantKnowledge`. Parallelizing the knowledge retrieval (which involves a database text search and potentially an AI semantic reranking step) significantly reduces the overall latency of the context construction.

**Learning (Regression):** Attempted to hoist `getFullPrompt` outside the tool execution loop in the chat handlers. While this reduced database calls, it introduced a "stale state" bug. Tools often modify the database (e.g., adding a task or a reminder), and if the system prompt is hoisted, the AI will not see its own updates in the context for subsequent iterations in the same turn.

**Action:** Always parallelize independent I/O and AI tasks within a service. Be cautious when hoisting context-building calls if the loop contains operations that modify that same context.

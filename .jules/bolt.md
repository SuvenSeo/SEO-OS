# Bolt's Performance Journal ⚡

## 2025-05-15 - [Optimization] Context Building and Tool Loop
**Learning:** The `buildContext` function was performing a redundant fetch of `episodic_memory` which was never used in the context string. Additionally, calling `getFullPrompt` inside the tool iteration loop caused multiple expensive database queries and AI semantic re-ranking calls for every tool step in a single request. Since current tools don't immediately change the context data (tasks, core memory, etc.) in a way that requires an instant refresh of the system prompt, this was purely overhead.
**Action:** Remove redundant queries from context service and move context generation outside of tool loops to ensure "build once, use many" for multi-step AI interactions.

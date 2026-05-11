## 2025-05-14 - [Redundant Semantic Reranking]
**Learning:** In LLM-based agent systems with tool loops, context building functions are often called multiple times per user message. If these functions perform expensive semantic reranking (involving additional LLM calls), it creates a significant performance bottleneck.
**Action:** Always cache results of semantic reranking or knowledge retrieval using a composite key of the user message and relevant search parameters (like keywords) to ensure it only runs once per unique exchange.

## 2025-05-14 - [Apparent Dead Code Risk]
**Learning:** In complex AI systems, some data fetches might appear unused in a specific function but could be part of a larger architectural pattern or used by utility functions within the same module.
**Action:** Before removing "unused" data fetches, perform a deep search for any references in the entire module and related services. If the codebase is transitioning patterns (e.g., moving history management from the system prompt to the messages array), ensure the data is truly redundant before deletion.

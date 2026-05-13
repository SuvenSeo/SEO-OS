
## 2025-05-15 - [Context Building & Knowledge Retrieval Cache]
**Learning:** Redundant LLM calls for semantic reranking during tool loops significantly increased latency. Parallel database queries are good, but frequent 'working_memory' lookups for transient state (like nudge times) benefit from short-lived in-memory caching.
**Action:** Implement TTL-based in-memory caching for expensive semantic reranking (5min) and high-frequency transient DB queries (1min).

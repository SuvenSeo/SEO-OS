# Bolt's Performance Journal

## 2025-05-22 - [Context Building Optimization]
**Learning:** Redundant database fetches and expensive semantic reranking during tool iteration loops were significantly slowing down the AI agent's response time. Implementing TTL-based caching for slow-changing data (working memory) and relatively stable retrieval results (knowledge base) provides a major performance boost. Also, removing unused code and redundant fetches (episodic memory) reduces overhead.
**Action:** Always check for redundant data fetches in loops and consider caching expensive LLM-based processing results like semantic reranking. Ensure cache keys are robust by sorting and normalizing inputs.

## 2025-05-15 - Optimized Context Generation and Knowledge Retrieval

**Learning:** Semantic reranking with LLMs is expensive and redundant when the user message and keywords remain the same across tool loop iterations. Additionally, when conversation history handling moves to the LLM message array, legacy database fetches for the same history in the system prompt become "ghost queries" that waste database resources.

**Action:** Implement TTL-based in-memory caching for LLM-intensive retrieval tasks (like semantic reranking). Ensure cache keys are sufficiently specific (e.g., including normalized user message) to maintain semantic accuracy. Audit context-building services to ensure all fetched data is actually utilized in the final prompt, especially after architectural shifts in how history is managed.

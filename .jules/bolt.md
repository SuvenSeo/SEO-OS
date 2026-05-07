## 2026-05-07 - Parallelized Context Building & Caching
**Learning:** The AI context-building process was performing ~8 sequential database roundtrips per message, leading to significant latency (~700ms+ in high-latency environments). Additionally, the system was re-fetching episodic memory in route handlers even though it was already available during context construction.

**Action:** Always parallelize independent database queries using `Promise.all`. For context-heavy AI apps, return the raw data used for the prompt (like recent messages) to calling routes to eliminate redundant fetches. Implement TTL-based in-memory caching for semi-static configuration and memory tables.

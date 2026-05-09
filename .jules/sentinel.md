## 2026-05-08 - [Fail-Open Auth and Tracked Secrets]
**Vulnerability:** The `requireAuth` middleware implemented a "fail-open" policy where missing configuration (CRON_SECRET) allowed all requests. Additionally, `secret.json` containing a Telegram Bot Token was tracked in Git, and most API routes lacked authentication checks.
**Learning:** Middleware that defaults to allowing access when configuration is missing is a significant risk. Security configurations should always fail-secure.
**Prevention:** Always implement fail-secure logic. Use global middleware to enforce authentication by default and explicitly opt-out public endpoints. Ensure all secret-containing files are correctly ignored by Git before they are committed.

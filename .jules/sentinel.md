## 2025-05-14 - Hardcoded Secret and Fail-Open Middleware
**Vulnerability:** A hardcoded Telegram Bot Token was found in `secret.json`, which was tracked by Git. Additionally, the `requireAuth` middleware implemented a "fail-open" policy, allowing all requests if the `CRON_SECRET` environment variable was missing.

**Learning:** Sensitive configuration files like `secret.json` can easily be accidentally included in Git if not explicitly ignored. Middleware that defaults to allowing access when misconfigured creates a massive security gap if environment variables are not set correctly in production.

**Prevention:** Always verify that sensitive files are in `.gitignore` before they are committed. Authentication middleware should follow a "fail-secure" principle, explicitly denying access if required security configurations or secrets are missing.

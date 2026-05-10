## 2025-05-19 - [Hardcoded Secret and Fail-Open Auth]
**Vulnerability:** A `secret.json` file containing a Telegram Bot Token was committed to the repository. Additionally, the authentication middleware was "failing open" by allowing requests if the `CRON_SECRET` was not configured.
**Learning:** Hardcoded secrets in JSON files are easily overlooked if not explicitly checked. Authentication logic should always prioritize security over developer convenience by failing closed.
**Prevention:** Use environment variables for all sensitive configuration and implement "fail-secure" patterns in all security-critical middleware.

## 2025-05-14 - [Secrets Exposure & Unprotected Endpoints]
**Vulnerability:** A hardcoded `secret.json` containing a Telegram Bot Token was tracked in Git. Multiple sensitive API endpoints (/api/chat/send, /api/config, /api/journal, and /api/telegram/webhook GET) lacked authentication.
**Learning:** Development-time secrets and debugging endpoints are often overlooked when moving to production. Relying on a "fail-open" middleware during development can hide missing auth calls in new routes.
**Prevention:** Use `.gitignore` strictly for any JSON/env files. Implement a "fail-closed" authentication policy where possible, or use a linter/scanner to ensure `requireAuth` is called in all `app/api` routes.

# SENTINEL'S JOURNAL - SEOS Security

## 2025-05-16 - Initial Security Audit
**Vulnerability:** Discovered hardcoded Telegram Bot Token in `secret.json` tracked by Git.
**Learning:** Legacy configuration files or temporary secrets often linger in repositories if not strictly ignored from the start.
**Prevention:** Always use environment variables for secrets and maintain a strict `.gitignore` policy.

**Vulnerability:** Fail-open policy in `requireAuth` middleware.
**Learning:** Defaulting to success when a security configuration is missing leads to accidental exposure.
**Prevention:** Implement "fail-closed" by default. Security checks should always require explicit success.

**Vulnerability:** Unprotected sensitive API endpoints.
**Learning:** Routes like `/api/config`, `/api/chat/send`, and `/api/journal` were exposed without any authentication checks, relying on "security by obscurity".
**Prevention:** All API endpoints should be protected by authentication middleware by default unless explicitly marked as public.

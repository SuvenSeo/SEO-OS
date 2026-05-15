# Sentinel Security Journal

## 2026-05-15 - Hardcoded Secrets and Unprotected API Routes
**Vulnerability:** Found a hardcoded Telegram Bot Token in `secret.json` tracked by Git. Also identified sensitive API routes (`/api/config`, `/api/telegram/webhook`) lacking authentication despite a `requireAuth` middleware being available.
**Learning:** Initial development often prioritizes functionality over security, leading to secrets being committed for convenience and internal API routes being left open.
**Prevention:** Always use environment variables for secrets and ensure all API routes have explicit authentication checks, especially those that modify system configuration or bot behavior.

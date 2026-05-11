## 2025-05-15 - [API Security Hardening]
**Vulnerability:** Several sensitive API routes (config, journal) were completely unprotected, and the existing `requireAuth` middleware implemented a "fail-open" policy when the security secret was missing.
**Learning:** Middleware should always implement "fail-secure" logic. Relying on environment variables being present for security checks can lead to accidental exposure if they are misconfigured.
**Prevention:** Explicitly check for the presence of security secrets and deny access if they are missing. Apply authentication to all sensitive routes by default.

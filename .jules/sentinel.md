## 2026-05-13 - [Hardcoded Telegram Bot Token in secret.json]
**Vulnerability:** A Telegram Bot Token was stored in plaintext within a file named `secret.json` in the repository root. This file was not listed in `.gitignore`, making it susceptible to being committed to version control.
**Learning:** The project lacks a robust mechanism for managing non-environment secrets, leading to fallback files like `secret.json`.
**Prevention:** Ensure all sensitive data is handled via environment variables (e.g., `.env`) and that a comprehensive `.gitignore` is in place from the start. Regularly audit for untracked JSON files that might contain configuration secrets.

## 2026-05-13 - [Unprotected Management Endpoints]
**Vulnerability:** The Telegram webhook `GET` handler allowed anyone to trigger administrative actions (setWebhook, updatePrompt) without authentication.
**Learning:** Development-time "convenience" endpoints often bypass existing security middleware.
**Prevention:** Apply `requireAuth` to all API routes by default, or use a global middleware if supported by the framework. Always assume `GET` requests to API routes should be authenticated if they perform side effects or reveal config.

## 2026-05-08 - [Hardcoded Telegram Bot Token]
**Vulnerability:** A hardcoded Telegram Bot Token was found in a committed `secret.json` file in the root directory.
**Learning:** Secrets stored in files that are not explicitly ignored will be committed to version control. In this case, `secret.json` was tracked and contained a live bot token.
**Prevention:** Never store secrets in tracked files. Use environment variables for all sensitive configuration. Always maintain an up-to-date `.gitignore`.

## 2026-05-07 - [Hardcoded Telegram Bot Token]
**Vulnerability:** A hardcoded Telegram Bot Token was found in a file named `secret.json` in the root of the repository. This file was tracked by Git and committed, exposing the bot's credentials.
**Learning:** Sensitive configuration files should never be committed to the repository, even if they are named "secret". The presence of this file indicates a bypass of standard environment variable practices.
**Prevention:** Always use environment variables for secrets and ensure that any local secret files are explicitly added to `.gitignore`. In this case, `secret.json` was missing from `.gitignore` despite other `.env` files being present.

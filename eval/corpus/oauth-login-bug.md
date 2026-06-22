---
name: oauth-login-bug
tier: episodic
importance: 7
date: 2026-05-10
metadata:
  topic: auth
---
Users could not log in because the OAuth token had expired. Rotating the OAuth client secret and clearing the cached token fixed the login failures.

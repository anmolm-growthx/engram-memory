---
name: deploy-rollback-rule
tier: semantic
importance: 9
date: 2026-05-12
metadata:
  topic: deploy
---
Rule: always run pending database migrations before deploying, and keep a one-command rollback ready. Distilled from the Tuesday production outage where a skipped migration took the site down.

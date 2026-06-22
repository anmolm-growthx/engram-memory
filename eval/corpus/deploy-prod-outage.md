---
name: deploy-prod-outage
tier: episodic
importance: 9
date: 2026-05-12
metadata:
  emotion: stress
  emotion_intensity: 0.9
  topic: deploy
---
Production broke after the Tuesday deploy because the database migration had not been run first. Logins and dashboards 500'd for twenty minutes. We rolled back, ran the pending migration, and redeployed.

---
name: comet-auto
description: "Comet Auto-Pilot — automatically resumes incomplete changes and drives the pipeline with pre-configured policies. Triggered automatically by SessionStart Hook."
---

# Comet Auto-Pilot

Automatically detects active Comet changes and drives the 5-phase pipeline (open → design → build → verify → archive) per `comet-auto.yaml` policies, pausing only on blocking conditions.

## Trigger

Triggered automatically by SessionStart Hook, or manually via `/comet-auto`.

[See Chinese version (skills-zh/comet-auto/SKILL.md) for full documentation]

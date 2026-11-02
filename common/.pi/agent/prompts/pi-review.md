---
description: Review a Pi release against our dotfiles without changing anything
argument-hint: "[version or release range]"
---
Review Pi ${@:-latest stable release} against my current dotfiles and workflow.

Report on:
1. Breaking changes that require us to adapt our configuration, extensions, SDK callers, or tests.
2. Features or fixes that can replace local workarounds. Prefer native support only when the released implementation covers our required behavior.
3. New features worth adopting, judged against the spirit of our existing setup rather than a generic release summary.

Read the applicable dotfiles instructions and inspect the current configuration and relevant source. Check the installed CLI version, workspace pins, and installed workspace dependencies separately. If the review baseline is unclear, find the previous review in Pi sessions and, when available, T3 Code threads. Include intervening releases when needed.

Use the official release notes and tagged source. Use repo_cache before inspecting public repository source. In particular, compare native public OpenAI Responses WebSocket and routing-hint support with our wrapper. Preserve subscription authentication, speed aliases, and the separate image-generation path when assessing replacements.

Distinguish confirmed regressions, possible risks, and optional improvements. Run relevant offline checks when useful. Test newer dependencies only in an isolated temporary copy. Do not treat tests against older dependencies as validation of the new release. Do not make paid model calls or start live MCP servers without permission.

Give a concise verdict, then findings in the three categories above. Include affected paths, evidence, recommended priority, workarounds to retain or remove, checks run, and remaining limits. Link the release sources.

This is a report-only request. Do not edit the repository or live settings, update live packages, deploy, reload active sessions, commit, or push. Do not start subagents unless I explicitly request them.

---
description: Find related GitHub issues for a query
agent: build
---

Search the upstream GitHub repository for issues matching the query.

Query: $ARGUMENTS

Use the `gh` CLI and include strong matches based on:
- similar titles/descriptions
- same errors, stack traces, or symptoms
- same subsystem/component
- overlapping feature requests

Return:
- issue number and title
- short reason it matches
- issue URL

If no clear matches are found, say so explicitly.

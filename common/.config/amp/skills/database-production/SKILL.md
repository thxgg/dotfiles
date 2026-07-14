---
name: database-production
description: Inspect or query the CODE Hospitality production PostgreSQL database. Load only when the user explicitly asks for production database work.
---

# Production Database

Use the bundled `database-production` MCP server only for explicitly requested production database work. Default to read-only inspection. Before any data or schema mutation, restate the exact production target and obtain explicit user confirmation for the mutation. Never infer production write authorization from a general debugging request.

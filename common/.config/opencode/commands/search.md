---
description: Search the codebase for functionality or behavior
agent: build
---

Search the current codebase for functionality related to the request.

Query: $ARGUMENTS

Process:
- Search with `rg` for key literals, function names, type names, and likely aliases
- Check config and scripts that may wire behavior indirectly
- Prioritize code touching input validation, auth, error handling, I/O, API boundaries, and expensive loops
- If useful, trace call flow across entry point -> handler -> core logic

Output:
- Ranked matches by relevance (`high`, `medium`, `low`)
- Each match with file path and a focused snippet
- A short synthesis of how the pieces connect

If no relevant matches are found, state that clearly and list what was searched.

---
name: shortcut-story
description: Investigate a Shortcut story and explore the codebase
---

# Shortcut Story Investigation

Fetch a Shortcut story and investigate the relevant code in the codebase.

## Instructions

### Step 1: Fetch the Story
1. Parse the story ID from: $ARGUMENTS
2. Fetch the story using `mcp__shortcut__stories-get-by-id` with `full: true`
3. Present a brief summary:
   - Story name, type (feature/bug/chore), and current state
   - Description
   - Any linked branches or PRs

### Step 2: Investigate the Codebase
Based on the story details:

1. **Identify keywords**: Extract relevant terms from the story name, description, and labels (e.g., feature names, error messages, component names)

2. **Search the codebase**: Use Grep and Glob to find:
   - Files/classes mentioned in the story
   - Code related to the described feature or bug
   - Error messages or patterns mentioned in the description

3. **Analyze relevant code**: Read the identified files to understand:
   - Current implementation
   - Potential root cause (for bugs)
   - Where changes would need to be made (for features)

4. **Check related branches**: If the story has linked branches, note what changes have already been attempted

### Step 3: Report Findings
Summarize:
- What the story is asking for
- Relevant files and code locations
- Initial analysis or potential approach
- Any questions or clarifications needed

## Usage
/shortcut-story <story-id>

Example: /shortcut-story 12345

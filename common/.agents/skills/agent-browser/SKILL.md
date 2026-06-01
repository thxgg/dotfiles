---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task.
---

# Browser Automation with agent-browser

Use `agent-browser` for browser automation tasks.

It is a fast native CLI that drives Chrome/Chromium via CDP and keeps a background daemon alive between commands, so multi-step workflows are efficient.

## Core Workflow

Follow this loop for nearly every task:

1. **Navigate**: `agent-browser open <url>`
2. **Snapshot**: `agent-browser snapshot -i`
3. **Interact with refs**: `agent-browser click @e1`, `agent-browser fill @e2 "text"`
4. **Re-snapshot after page changes**

```bash
agent-browser open https://example.com/login
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser snapshot -i
```

## Refs First

Prefer refs from `snapshot` over CSS selectors.

```bash
agent-browser snapshot -i
# - button "Submit" [ref=e1]
# - textbox "Email" [ref=e2]

agent-browser click @e1
agent-browser fill @e2 "test@example.com"
```

Why refs are preferred:
- deterministic and AI-friendly
- faster than re-querying the DOM
- map directly to the snapshot you just inspected

Refs become stale after navigation or meaningful DOM changes, so re-run `agent-browser snapshot -i` whenever the page changes.

## Command Chaining

When you do not need intermediate output, chain commands with `&&`.

```bash
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i
agent-browser fill @e1 "user@example.com" && agent-browser fill @e2 "password123" && agent-browser click @e3
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser screenshot page.png
```

Use separate commands when you need to inspect the snapshot output before taking the next action.

## Authentication Patterns

Choose the lightest option that fits the task.

### 1. Reuse an existing Chrome session

```bash
agent-browser --auto-connect state save ./auth.json
agent-browser --state ./auth.json open https://app.example.com/dashboard
```

### 2. Persistent browser profile

```bash
agent-browser --profile ~/.agent-browser/myapp open https://app.example.com/login
agent-browser --profile ~/.agent-browser/myapp open https://app.example.com/dashboard
```

### 3. Auto-save cookies and localStorage

```bash
agent-browser --session-name myapp open https://app.example.com/login
agent-browser close
agent-browser --session-name myapp open https://app.example.com/dashboard
```

### 4. Manual state save/load

```bash
agent-browser state save ./auth.json
agent-browser state load ./auth.json
agent-browser open https://app.example.com/dashboard
```

### 5. Auth vault

```bash
echo "$PASSWORD" | agent-browser auth save github --url https://github.com/login --username user --password-stdin
agent-browser auth login github
```

## Essential Commands

### Navigation

```bash
agent-browser open <url>
agent-browser back
agent-browser forward
agent-browser reload
agent-browser close
agent-browser close --all
```

### Snapshot and interaction

```bash
agent-browser snapshot -i
agent-browser click @e1
agent-browser click @e1 --new-tab
agent-browser fill @e2 "text"
agent-browser type @e2 "text"
agent-browser keyboard type "text"
agent-browser keyboard inserttext "text"
agent-browser press Enter
agent-browser select @e3 "option"
agent-browser check @e4
agent-browser uncheck @e4
agent-browser hover @e5
agent-browser scroll down 500
agent-browser scroll down 500 --selector "div.content"
agent-browser scrollintoview @e6
agent-browser upload @e7 ./file.pdf
```

### Waits

Prefer semantic waits over hard-coded sleeps.

```bash
agent-browser wait @e1
agent-browser wait --load networkidle
agent-browser wait --url "**/dashboard"
agent-browser wait --text "Welcome"
agent-browser wait --fn "window.ready === true"
agent-browser wait "#spinner" --state hidden
agent-browser wait 2000
```

### Read page state

```bash
agent-browser get text @e1
agent-browser get html @e1
agent-browser get value @e2
agent-browser get attr @e1 href
agent-browser get title
agent-browser get url
agent-browser get count "button"
agent-browser get box @e1
agent-browser is visible @e1
agent-browser is enabled @e1
agent-browser is checked @e1
```

### Screenshots and PDFs

```bash
agent-browser screenshot
agent-browser screenshot page.png
agent-browser screenshot --full
agent-browser screenshot --annotate
agent-browser screenshot --screenshot-dir ./shots
agent-browser screenshot --screenshot-format jpeg --screenshot-quality 80
agent-browser pdf page.pdf
```

### Sessions

Use named sessions when running more than one browser flow.

```bash
agent-browser --session agent1 open https://site-a.com
agent-browser --session agent2 open https://site-b.com
agent-browser session
agent-browser session list
```

### Tabs, frames, and dialogs

```bash
agent-browser tab
agent-browser tab new https://example.com
agent-browser tab 2
agent-browser tab close 2
agent-browser frame @e2
agent-browser frame main
agent-browser dialog status
agent-browser dialog accept
agent-browser dialog accept "input text"
agent-browser dialog dismiss
```

### Network and storage

```bash
agent-browser network requests
agent-browser network requests --type xhr,fetch
agent-browser network requests --method POST
agent-browser network request <requestId>
agent-browser network route "**/api/*" --abort
agent-browser network har start
agent-browser network har stop ./capture.har
agent-browser cookies
agent-browser storage local
agent-browser storage session
```

### Viewport and device emulation

```bash
agent-browser set viewport 1920 1080
agent-browser set viewport 1920 1080 2
agent-browser set device "iPhone 14"
agent-browser set media dark
agent-browser set offline on
```

### Diffing and debugging

```bash
agent-browser diff snapshot
agent-browser diff screenshot --baseline before.png
agent-browser diff url https://staging.example.com https://prod.example.com --screenshot
agent-browser console
agent-browser errors
agent-browser highlight @e1
agent-browser inspect
agent-browser trace start
agent-browser trace stop ./trace.json
agent-browser profiler start
agent-browser profiler stop ./profile.json
```

### JavaScript evaluation

For simple expressions:

```bash
agent-browser eval 'document.title'
```

For complex JavaScript, prefer stdin to avoid shell-quoting issues:

```bash
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify(
  Array.from(document.querySelectorAll('a')).map(a => a.href)
)
EVALEOF
```

## Annotated Screenshots

Use `--annotate` when visual layout matters or the page has icon-only or hard-to-describe controls.

```bash
agent-browser screenshot --annotate
# [1] @e1 button "Submit"
# [2] @e2 link "Home"
```

After an annotated screenshot, you can use the listed refs directly.

## Slow Pages and Timeouts

The default timeout is 25 seconds.

For slow sites:
- use `agent-browser wait --load networkidle` after navigation
- wait for a specific element or URL when possible
- set `AGENT_BROWSER_DEFAULT_TIMEOUT` for consistently slow flows

```bash
export AGENT_BROWSER_DEFAULT_TIMEOUT=45000
```

## Security for Agent Workflows

For safer agent usage on the open web, consider:

```bash
export AGENT_BROWSER_CONTENT_BOUNDARIES=1
export AGENT_BROWSER_ALLOWED_DOMAINS="example.com,*.example.com"
export AGENT_BROWSER_MAX_OUTPUT=50000
```

Useful safety features:
- `--content-boundaries` to mark page-sourced output
- `--allowed-domains` to restrict browsing targets
- `--max-output` to avoid context flooding
- `--action-policy` or `--confirm-actions` for sensitive actions

## Best Practices

- Prefer `snapshot -i` and refs over CSS selectors.
- Re-snapshot after navigation, modal opens, dynamic UI updates, or form submission.
- Prefer `fill` over `type` unless you intentionally want incremental keystrokes.
- Prefer semantic waits over fixed-duration sleeps.
- Use named sessions for concurrent tasks.
- Use `--json` when machine-readable output helps.
- Close sessions when done.

## Quick Reminder

If you need a refresher in-session, run:

```bash
agent-browser --help
```

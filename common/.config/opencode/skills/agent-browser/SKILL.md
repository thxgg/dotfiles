---
name: agent-browser
description: Browser automation CLI for AI agents using Playwright. Use when tasks require web browsing, scraping, form filling, testing web applications, taking screenshots, or any web interaction.
---

# agent-browser

Browser automation CLI for AI agents. Built on Playwright with Rust CLI + Node.js daemon architecture.

## Installation Check

Before using, verify installation:
```bash
which agent-browser || echo "Not installed - run: npm install -g agent-browser && agent-browser install"
```

Linux requires: `agent-browser install --with-deps`

## Architecture

- **Rust CLI**: Fast native binary for command parsing and daemon communication
- **Node.js daemon**: Manages Playwright browser instance, persists between commands
- Daemon auto-starts on first command, stays alive for fast subsequent operations
- Each session has own daemon process + Unix socket (TCP on Windows)

## Core Workflow

The fundamental pattern you MUST follow:

1. **Open page**: `agent-browser open <url>`
2. **Get snapshot**: `agent-browser snapshot -i` (interactive elements only)
3. **Use refs**: `agent-browser click @e2` / `agent-browser fill @e3 "text"`
4. **Re-snapshot after page changes** - refs become stale after navigation/DOM changes

## Refs (Primary Selection Method)

Snapshot generates ARIA accessibility tree with `[ref=eN]` tags. Refs map to `getByRole()` locators internally.

```bash
agent-browser snapshot -i
# - heading "Example Domain" [ref=e1] [level=1]
# - button "Submit" [ref=e2]
# - textbox "Email" [ref=e3]
# - link "Learn more" [ref=e4]

agent-browser click @e2           # Click button
agent-browser fill @e3 "test@example.com"
agent-browser get text @e1        # Get heading text
```

Ref syntax: `@e1`, `e1`, or `ref=e1` all work.

**Why refs over CSS selectors?**
- Deterministic: points to exact element from snapshot
- Fast: no DOM re-query, uses cached role/name locator
- AI-friendly: snapshot + ref workflow optimal for LLMs

### Interactive Roles (get refs automatically)
`button`, `link`, `textbox`, `checkbox`, `radio`, `combobox`, `listbox`, `menuitem`, `option`, `searchbox`, `slider`, `spinbutton`, `switch`, `tab`, `treeitem`

### Content Roles (get refs when named)
`heading`, `cell`, `gridcell`, `columnheader`, `rowheader`, `listitem`, `article`, `region`, `main`, `navigation`

## Command Reference

### Navigation
```bash
agent-browser open <url>          # Auto-prepends https:// if needed
agent-browser back
agent-browser forward
agent-browser reload
agent-browser close               # Closes browser + daemon
```

### Interaction
```bash
agent-browser click <sel>         # Left click
agent-browser dblclick <sel>      # Double click
agent-browser fill <sel> <text>   # Clear field + set value (atomic, preferred)
agent-browser type <sel> <text>   # Type character by character (preserves existing)
agent-browser press <key>         # Key press: Enter, Tab, Control+a, Shift+Tab
agent-browser keydown <key>       # Hold key down
agent-browser keyup <key>         # Release key
agent-browser hover <sel>
agent-browser focus <sel>
agent-browser select <sel> <val>  # Select dropdown option by value
agent-browser check <sel>         # Check checkbox
agent-browser uncheck <sel>       # Uncheck checkbox
agent-browser scroll up|down|left|right [px]  # Default 300px
agent-browser scrollintoview <sel>
agent-browser drag <src> <tgt>    # Drag and drop
agent-browser upload <sel> <file1> [file2...]
```

### Get Info
```bash
agent-browser get text <sel>      # textContent
agent-browser get html <sel>      # innerHTML
agent-browser get value <sel>     # input value
agent-browser get attr <sel> <attr>
agent-browser get title
agent-browser get url
agent-browser get count <sel>     # Number of matching elements
agent-browser get box <sel>       # Bounding box {x,y,width,height}
```

### Check State
```bash
agent-browser is visible <sel>
agent-browser is enabled <sel>
agent-browser is checked <sel>
```

### Snapshot Options
```bash
agent-browser snapshot            # Full accessibility tree
agent-browser snapshot -i         # Interactive elements only (RECOMMENDED)
agent-browser snapshot -c         # Compact (remove empty structural elements)
agent-browser snapshot -d 3       # Limit depth to 3 levels
agent-browser snapshot -s "#main" # Scope to CSS selector
agent-browser snapshot -i -c -d 5 # Combine options
agent-browser snapshot --json     # Machine-readable output
```

### Screenshots & PDF
```bash
agent-browser screenshot [path]   # PNG to stdout (base64) or file
agent-browser screenshot --full   # Full page screenshot
agent-browser screenshot -f page.png
agent-browser pdf <path>          # Save as PDF
```

### Wait (Use These Instead of Sleep)
```bash
agent-browser wait <selector>     # Wait for element visible
agent-browser wait <ms>           # Wait for time (only if no better option)
agent-browser wait --text "Welcome"
agent-browser wait --url "**/dashboard"
agent-browser wait --load networkidle  # load | domcontentloaded | networkidle
agent-browser wait --fn "window.ready === true"  # Wait for JS condition
```

### Find (Semantic Locators)
```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "test@test.com"
agent-browser find placeholder "Search" fill "query"
agent-browser find alt "Logo" click        # By alt text
agent-browser find title "Close" click     # By title attribute
agent-browser find testid "submit-btn" click
agent-browser find first ".item" click     # First match
agent-browser find last ".item" click      # Last match
agent-browser find nth 2 "a" text          # Nth match (0-indexed)
```

### Sessions (Isolated Browser Instances)
```bash
agent-browser --session agent1 open site-a.com
agent-browser --session agent2 open site-b.com
AGENT_BROWSER_SESSION=agent1 agent-browser click @e2

agent-browser session list        # List active sessions
agent-browser session             # Show current session
```

Each session has: own browser, cookies/storage, navigation history, auth state.

### Storage & Cookies
```bash
agent-browser cookies             # Get all cookies
agent-browser cookies set <name> <val>
agent-browser cookies clear

agent-browser storage local       # Get all localStorage
agent-browser storage local <key> # Get specific key
agent-browser storage local set <k> <v>
agent-browser storage local clear
agent-browser storage session     # Same for sessionStorage
```

### Tabs & Windows
```bash
agent-browser tab                 # List tabs
agent-browser tab new [url]       # New tab
agent-browser tab <n>             # Switch to tab n
agent-browser tab close [n]       # Close tab
agent-browser window new          # New window (new context)
```

### Frames
```bash
agent-browser frame <sel>         # Switch to iframe by selector
agent-browser frame main          # Back to main frame
```

### Dialogs (alert/confirm/prompt)
```bash
agent-browser dialog accept [text]  # Accept (with optional prompt text)
agent-browser dialog dismiss        # Dismiss
```

### Network Interception
```bash
agent-browser network route <url>              # Intercept requests
agent-browser network route <url> --abort      # Block requests
agent-browser network route <url> --body '{"mock":true}'  # Mock response
agent-browser network unroute [url]            # Remove routes
agent-browser network requests                 # View tracked requests
agent-browser network requests --filter api    # Filter by URL pattern
```

### Browser Settings
```bash
agent-browser set viewport <w> <h>
agent-browser set device "iPhone 14"   # Emulate device
agent-browser set geo <lat> <lng>      # Geolocation
agent-browser set offline [on|off]     # Toggle offline mode
agent-browser set media dark|light     # Color scheme
agent-browser set credentials <u> <p>  # HTTP basic auth
agent-browser set headers '{"X-Custom":"value"}'
```

### Debug & Tracing
```bash
agent-browser --headed open <url>   # Show browser window (not headless)
agent-browser console               # View console messages
agent-browser console --clear       # Clear console
agent-browser errors                # View page errors
agent-browser errors --clear
agent-browser highlight <sel>       # Highlight element visually
agent-browser eval <js>             # Run JavaScript, returns result
agent-browser trace start [path]    # Start recording trace
agent-browser trace stop [path]     # Stop and save trace
```

### Auth State Persistence
```bash
agent-browser state save auth.json  # Save cookies, localStorage, sessionStorage
agent-browser state load auth.json  # Load at next launch (must be at browser start)
```

### Mouse Control
```bash
agent-browser mouse move <x> <y>    # Move to coordinates
agent-browser mouse down [button]   # left|right|middle
agent-browser mouse up [button]
agent-browser mouse wheel <dy> [dx] # Scroll wheel
```

## Global Options

| Option | Description |
|--------|-------------|
| `--session <name>` | Isolated session (or `AGENT_BROWSER_SESSION` env) |
| `--json` | JSON output (for parsing) |
| `--full, -f` | Full page screenshot |
| `--headed` | Show browser window |
| `--name, -n` | Locator name filter |
| `--exact` | Exact text match |
| `--debug` | Debug output |

## Selector Priority

1. **Refs** (preferred): `@e1`, `@e2` from snapshot
2. **CSS**: `#id`, `.class`, `div > button`
3. **Text**: `text=Submit`
4. **XPath**: `xpath=//button`

## Common Patterns

### Login Flow
```bash
agent-browser open https://example.com/login
agent-browser snapshot -i
# Identify refs for username, password, submit
agent-browser fill @e2 "username"
agent-browser fill @e3 "password"
agent-browser click @e4
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json  # Persist auth for later
```

### Form Submission
```bash
agent-browser open https://example.com/form
agent-browser snapshot -i --json
# Parse refs from JSON response
agent-browser fill @e1 "John Doe"
agent-browser fill @e2 "john@example.com"
agent-browser select @e3 "option-value"
agent-browser check @e4
agent-browser click @e5
agent-browser wait --text "Success"
```

### Scraping Data
```bash
agent-browser open https://example.com/data
agent-browser snapshot
agent-browser get text @e1
agent-browser get attr @e2 "href"
agent-browser eval "document.querySelectorAll('.item').length"
agent-browser eval "JSON.stringify([...document.querySelectorAll('.price')].map(e => e.textContent))"
```

### Multi-page Navigation
```bash
agent-browser open https://example.com
agent-browser snapshot -i
agent-browser click @e3  # Navigate to new page
agent-browser wait --load networkidle
agent-browser snapshot -i  # Fresh snapshot for new page (CRITICAL)
```

### Parallel Browser Sessions
```bash
# Session 1
agent-browser --session scraper1 open https://site-a.com
agent-browser --session scraper1 snapshot -i

# Session 2 (can run concurrently)
agent-browser --session scraper2 open https://site-b.com
agent-browser --session scraper2 snapshot -i
```

### Mock API Response
```bash
agent-browser network route "**/api/users" --body '[{"id":1,"name":"Mock User"}]'
agent-browser open https://example.com  # App sees mocked data
agent-browser network unroute "**/api/users"
```

## Anti-Patterns (AVOID)

- **Using CSS selectors when refs available** - refs from snapshot are deterministic
- **Skipping snapshot after page changes** - refs become stale after navigation
- **Using `type` when `fill` works** - `fill` atomically clears + sets, `type` appends
- **Hardcoding wait times** - use semantic waits (`--text`, `--url`, `--load`, `--fn`)
- **Using `--headed` in automation** - only for debugging
- **Calling `state load` after browser started** - must be at launch time

## Timeouts

Default timeout: 10 seconds. Commands fail after timeout if element not found or condition not met.

## Troubleshooting

If commands fail:
1. Check if daemon is running: `agent-browser session`
2. Try closing and reopening: `agent-browser close && agent-browser open <url>`
3. Use `--debug` flag for verbose output
4. Check for stale refs - always re-snapshot after page changes

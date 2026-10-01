# Subscription usage

Local Pi extension for legacy Codex and Anthropic subscription quotas. It adapts
T3 Code's window parsing, overage interpretation, and reset-credit safeguards to
Pi. It is a dashboard, not a replacement for Pi's provider runtime.

## Command

`/usage` opens the native **Subscription usage** menu. It has exactly three
entries: OpenAI, Anthropic, and Close. Provider rows use the footer's remaining
bar, percentage, and usable reset count, without its leading pipe. Only Anthropic
rows include window duration labels; OpenAI duration labels are hidden everywhere
in quota displays. Parsing and storage still retain every reported window.
An unavailable provider remains selectable so its details can explain the error.
Select a provider to open its details. The **Resets inventory** action appears
only when that account has at least one currently usable reset. Back always appears.
There are no subcommands or top-level refresh/reset actions. Opening `/usage`
refreshes both providers when the shared polling deadline permits it.

All quota percentages mean **remaining**. Block bars fill as remaining allowance
increases and empty as it is consumed. The interactive menu always lists both
providers. Text reports and the footer show only the current model's provider: `openai` and `openai-codex` match
the legacy Codex monitor, and `anthropic` matches Claude. Unsupported providers
show no quota status. This display grouping does not equate legacy Codex quota
with the new OpenAI token-sharing allowance.

Details use OpenAI/Anthropic headings, relative last-check ages, and relative
reset countdowns (for example, `2m 5s ago` and `resets in 6d 22h`). Unknown reset
times are omitted. OpenAI shows account ID, marketing plan name, compact purchased
credits (`62500` becomes `62.5k`), and usable resets. Anthropic shows organization
name and aligned, duration-labelled usage rows. Zero usable resets read `none`;
unknown inventory remains `unavailable`, not zero. Error, stale, and overage/spend
notices remain visible. Inventory headings are **OpenAI Resets** and
**Anthropic Resets**, with rows such as `Reset · expires in 20d 5h`, followed by
Back. Anthropic grants expand into one row per remaining reset; zero-count grants
produce no rows. Unknown Anthropic expiry is omitted, not labelled unknown.
Reset rows are never numbered. The interactive selector keeps hidden row values
separate from visible labels, so identical labels still select the correct grant.
It uses Pi's standard list components. RPC clients that can only return label
text cannot safely select duplicate rows; those lists require interactive Pi.
Large inventories use pages of 100 rows instead of allocating an unbounded list
from provider-reported counts.

Confirmation uses **OpenAI Reset Redeem** or **Anthropic Reset Redeem**, the
selected reset's relative expiry when known, and Yes/No choices. Yes includes
`(another reset expires sooner)` only when both expiry times are known and another
usable grant/credit expires sooner. Tied, expired, or unusable credits do not
trigger that warning. Credit/grant IDs remain bound internally rather than
appearing in normal confirmation. Each Anthropic row retains its original grant
ID and full count for the preflight recheck; confirmation spends one reset, not
the whole grant. Expired/unusable entries and pending retry warnings remain explicit.

The status entry uses Pi's grey `dim` theme color,
`•` separators like the extension manager, and a leading `|` separator. It
composes with the existing Pi footer and does not install a custom footer.
Before the first report arrives, an eight-cell bar moves one block across its
empty cells and shows a spinner in place of the percentage: `░░█░░░░░ ⠹%`.
These indicators show activity, not remaining allowance. Existing reports stay
visible during later refreshes. The animation stops when the selected provider
finishes, on unsupported model selections, and on shutdown/reload. If no report
is available after a failed query, the status disappears; `/usage` shows the error.
Set `PI_USAGE_REDUCED_MOTION=1` for a static block and `…%` placeholder instead.
The reset inventory and confirmation retain their account-specific safeguards.
The inventory shows expired, paused, unavailable, and unknown credits as well as
usable credits. Only usable credits can reach the confirmation dialog.

Reset redemption is user-only. No model tool can redeem a credit. A native
confirmation is bound to the exact account and credit. The extension rechecks
login identity, eligibility, and the confirmed grant count before sending.
Overlapping confirmations cannot silently spend another reset from the same
multi-use Claude grant. A reset is never automatic.
Without a UI, `/usage` prints the report and redemption is unavailable.

## Authentication and provider limits

### Codex

The extension uses Pi's **`openai-codex` OAuth** credential and its token's account
claim. Pi owns refresh and persistence. There is no Codex CLI fallback, separate
`~/.codex/auth.json` lookup, or independently refreshed token.

The read routes are `https://chatgpt.com/backend-api/wham/usage` and
`/backend-api/wham/rate-limit-reset-credits`. Redemption sends one POST to the
reset-credit `consume` route. It uses the documented T3 adapter request shape,
not a sequence of guessed mutation bodies.

**The new `openai` Sign in with ChatGPT token-sharing login is different.** Its
tokens are not sent to legacy backend routes. Legacy Codex usage must not be
read as the allowance for current `openai` chat models or Fast/Ultrafast aliases.
An existing Painter legacy login can supply the separate Codex credential.
Do not remove or change the new OpenAI login to use this dashboard.

Actual window durations remain stored even though OpenAI quota displays hide
the labels. Duration-less Free/Go windows use the monthly fallback internally. Spark/model-specific events cannot overwrite the main
Codex allowance. Sparse events retain prior windows, reset times, and duration.
Workspace credits and spend caps remain separate from quota percentages.

### Anthropic

The extension uses Pi's **`anthropic` OAuth** credential. API-key billing and
environment-key overrides are not subscription accounts. It reads
`https://api.anthropic.com/api/oauth/profile` to identify the account and its
organization. It does not infer an organization from a separate Claude Code
login. Profile responses without usable identity disable access safely.

Quota and inventory reads use `/api/oauth/usage?cedar_ember=1&skip_spend=1`.
Redemption uses `/api/organizations/<organization>/reset_rate_limits` with
`program`, `grant_id`, and a durable `request_id`. Every OAuth request includes
`anthropic-beta: oauth-2025-04-20`.

Usage endpoint percentages are 0–100. Native response-header utilization and
SDK-shaped `rate_limit_event` utilization are 0–1 fractions. The parsers do not
infer units from small numbers. Dynamic `model_scoped` and raw `limits[]`
weekly-scoped buckets retain their display names. Paid overage indicators can
permit a request even when the base allowance is full or rejected.

Pi normally streams the Messages API, not Claude Agent SDK events. Native
response headers provide the normal passive path. The SDK-shaped event parser
is supported only when such an event is actually exposed. This extension does
not start Claude Code or claim to reproduce its complete runtime.

## Refresh and mutation safety

- Interactive sessions read usage at startup and every five minutes. Startup
  and model-selection handlers start background reads without waiting for network
  responses. Each provider publishes its result without waiting for the other.
  Explicit commands still wait for their reads. Non-interactive sessions do not
  start automatic reads or animation timers.
- Opening the menu, model changes, and other Pi processes respect the same
  account query deadline. There is no force-refresh bypass.
- A query 429 means endpoint throttling, not model quota exhaustion.
- `Retry-After` accepts seconds and HTTP dates. Missing values use 15 minutes;
  delays are bounded to 30 seconds–one hour.
- Last-good bars remain visible and marked stale after query failures.
  Logout/account changes cannot retain another login's quota or inventory.
- Optional reset-inventory failure does not hide successful Codex usage bars.
- Authentication remains Pi-owned. Redirects are rejected. HTTP reads are
  bounded to 10 seconds and 512 KiB; mutation requests use 25 seconds.
- No quota query sends a prompt, opens MCP connections, or runs a generation probe.
- Reset claims serialize per account across Pi processes. The request ID is
  saved and synced before POST. A lost or unconfirmed result keeps it across
  reload/restart. The menu offers a retry of that exact credit and blocks other
  credits until the outcome is known.
- A confirmed claim remains confirmed if the follow-up quota read fails.
- Explicit reset errors and outcomes do not change Pi's model retry policy.

State lives at `~/.local/state/pi-subscription-usage/<agent-dir hash>/`. Account
filenames use hashed identities. The state contains quota snapshots and pending
request IDs, never tokens. Files use mode 0600; new directories use 0700.
Do not remove state while a claim is unconfirmed: that would discard its
idempotency key. Separate Pi agent directories have separate state namespaces.
The shared cache/lock covers quota reads and reset claims. Claude profile
identity caching is process-local; it is not cross-process deduplicated.

## Development and activation

This directory is an npm workspace. Dependency and source changes do not imply
permission to deploy. From the repository root:

```sh
npm --prefix common/.pi run check
PYTHONDONTWRITEBYTECODE=1 python3 tests/pi-bootstrap.test.py
```

Install the updated workspace dependencies before loading the extension. Follow
[`../../../README.md`](../../../README.md) for the frozen-install procedure and
Pi-only deployment. After authorized deployment, run `/reload` in Pi. Do not
load another `/usage` extension alongside this one.

The offline tests use synthetic credentials, injected HTTP, temporary private
state, two-process lock checks, native-dialog seams, and the actual Pi CLI.
They do not contact providers, verify live endpoint eligibility, or redeem
real reset credits. Live quota and reset compatibility remains unverified.
The provider endpoints and reset programs can change without notice.

## Integration decision

The adapter audit covered Pi's native auth resolver, Painter's legacy image
client, the subagent job store, and web-tools' redaction/HTTP modules. Pi auth is
reused. The image and web adapters do not own subscription-quota protocols.
The synchronous job lock cannot span awaited HTTP requests. This workspace uses
an asynchronous heartbeat lock with durable atomic state, and a local secret
wrapper so it does not depend on another extension's discovery or deployment.
Domain rules stay in `domain.ts`, provider/persistence parsing in `protocol.ts`,
refresh/redemption policy in `service.ts`, and Pi/HTTP/storage in adapters.
The entry point wires these modules and owns timer cancellation.

Unlike T3's native CLI/SDK integration, this extension uses fixed-origin direct
OAuth metadata endpoints. It does not launch app-server, enforce turn stops,
change automatic retry rules, or manage CLIProxy routing cooldowns. This avoids
probing through a different CLI account but limits runtime parity. The new
OpenAI token-sharing quota API is deliberately unsupported until its separate
protocol is established.

## Source reference

OpenAI marketing labels were checked against [About ChatGPT Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-plans):
`prolite` → Pro 100, `pro` → Pro 200, `promax` → Pro 500. Internal plan identifiers
were cross-checked in `openai/codex`, `codex-rs/protocol/src/auth.rs`, commit
`01fc69f4026735edfdf6789820549727a4867b11`. Unknown plan names remain visible
rather than being guessed. The [official pricing guide](https://learn.chatgpt.com/docs/pricing)
states that Pro currently has no five-hour limit, but Plus and Standard Business
still do. Hiding labels is a presentation choice, not a change to quota parsing.

Behavior reference: [T3 Code](https://github.com/pingdotgg/t3code), commit
`5cc99e1c23980d7995a13c47f969b47cb68ed1be`, especially `codexUsageLimits.ts`,
`claudeUsageLimits.ts`, `claudeResetCredits.ts`, `resetCreditCoordinator.ts`, and
`usage/cliproxyApi.ts`. This is a local implementation, not an official Pi or
T3 package. T3's MIT notice is retained in `LICENSE-T3`.

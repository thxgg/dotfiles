import { canRedeem, type Account, type ResetCredit, type Snapshot } from "./domain.ts";
import { availableResets } from "./protocol.ts";
import { SubscriptionUsage, type UsageView } from "./service.ts";

/** Native Pi dialogs; no custom footer or terminal implementation is needed. */
export interface UsageUI {
  readonly hasUI: boolean;
  select(title: string, choices: string[], labels?: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, severity?: "info" | "warning" | "error"): void;
}

/** Match both OpenAI model routes to the separately monitored legacy Codex account. */
export function viewsForModel(views: readonly UsageView[], modelProvider: string | undefined): readonly UsageView[] {
  const provider = modelProvider === "openai" || modelProvider === "openai-codex" ? "codex" :
    modelProvider === "anthropic" ? "anthropic" : undefined;
  return provider ? views.filter(view => view.provider === provider) : [];
}

function remaining(usedPercent: number): number {
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

function quotaText(usedPercent: number, width: number, decimals: number): string {
  const left = remaining(usedPercent);
  const filled = Math.round(left / 100 * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${left.toFixed(decimals)}%`;
}

const openAIPlans = new Map([
  ["free", "Free"], ["go", "Go"], ["plus", "Plus"],
  ["prolite", "Pro 100"], ["pro", "Pro 200"], ["promax", "Pro 500"],
  ["team", "Business"], ["business", "Business"],
  ["enterprise", "Enterprise"], ["hc", "Enterprise"],
  ["edu", "Edu"], ["education", "Edu"],
]);
const compactCredits = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Two nonzero units, rounded down; the clock is supplied by the caller. */
function duration(milliseconds: number): string {
  let seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const parts: string[] = [];
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]] as const) {
    const value = Math.floor(seconds / size);
    if (value > 0) parts.push(`${value}${unit}`);
    seconds %= size;
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "0s";
}

/** Provider-specific details; percentages always mean remaining allowance. */
export function renderView(view: UsageView, now: number): string {
  const snapshot = view.snapshot;
  const account = view.account ?? snapshot?.account;
  const codex = view.provider === "codex";
  const lines = [codex ? "OpenAI" : "Anthropic", ""];
  if (codex) {
    lines.push(`ID: ${account?.accountId ?? "not reported"}`);
    lines.push(`Plan: ${snapshot?.plan ? openAIPlans.get(snapshot.plan.toLowerCase()) ?? snapshot.plan : "not reported"}`);
  } else lines.push(`Organization: ${account?.organizationName ?? "not reported"}`);
  const age = snapshot ? now - snapshot.checkedAt : undefined;
  lines.push(`Last checked: ${age === undefined ? "not reported" : age < 1000 ? "just now" : `${duration(age)} ago`}${view.error && snapshot ? " · STALE" : ""}`);
  if (snapshot) {
    snapshot.windows.forEach((window, index) => {
      const reset = window.resetsAt === undefined ? "" : ` · resets in ${duration(window.resetsAt - now)}`;
      lines.push(`${index === 0 ? "Usage: " : "       "}${codex ? "" : `${window.label} · `}${quotaText(window.usedPercent, 16, 1)}${reset}`);
    });
    if (!snapshot.windows.length) lines.push("Usage: unavailable");
    if (codex) lines.push(`Credits: ${snapshot.purchasedCredits === undefined ? "not reported" : compactCredits.format(snapshot.purchasedCredits).replace("K", "k")}`);
    lines.push(`Resets: ${snapshot.inventory.kind === "known" ? availableResets(snapshot.inventory, now) || "none" : "unavailable"}`);
    if (snapshot.notice) lines.push(snapshot.notice);
    if (snapshot.inventory.kind === "unavailable") lines.push(snapshot.inventory.message);
  } else lines.push("Usage: unavailable", "Resets: unavailable");
  if (view.error) lines.push(view.error.message, ...(view.error.retryAt ? [`Next query in ${duration(view.error.retryAt - now)}`] : []));
  return lines.join("\n");
}

/** Initial loading is indeterminate: neither the block nor spinner reports quota. */
export function renderLoadingStatus(modelProvider: string | undefined, frame: number, motion: "animated" | "reduced" = "animated"): string | undefined {
  const label = modelProvider === "openai" || modelProvider === "openai-codex" ? "OpenAI" : modelProvider === "anthropic" ? "Anthropic" : undefined;
  if (!label) return undefined;
  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const position = motion === "reduced" ? 3 : Math.floor(frame / 2) % 8;
  const indicator = motion === "reduced" ? "…" : spinner[frame % spinner.length];
  return `| ${label} • ${"░".repeat(position)}█${"░".repeat(7 - position)} ${indicator}%`;
}

/** Shared quota row for the provider menu and footer. */
function renderSummary(view: UsageView, now: number): string {
  const label = view.provider === "codex" ? "OpenAI" : "Anthropic";
  const snapshot = view.snapshot;
  if (!snapshot) return `${label} • unavailable`;
  const windows = snapshot.windows.map(w => `${view.provider === "codex" ? "" : `${w.label} `}${quotaText(w.usedPercent, 8, 0)}`).join(" • ");
  const resets = availableResets(snapshot.inventory, now);
  return `${label}${windows ? ` • ${windows}` : ""}${resets ? ` • ↻ ${resets}` : ""}${view.error ? " [stale]" : ""}`;
}

/** Small status entry composes with Pi's existing footer. */
export function renderStatus(views: readonly UsageView[], now: number, modelProvider: string | undefined): string | undefined {
  const entries = viewsForModel(views, modelProvider).filter(v => v.snapshot).map(view => renderSummary(view, now));
  return entries.length ? `| ${entries.join(" | ")}` : undefined;
}

function creditChoice(credit: ResetCredit, now: number, provider: Account["provider"]): string {
  const expiry = credit.expiresAt === undefined ? (provider === "anthropic" ? "" : "expiry unknown") : credit.expiresAt <= now
    ? `expired ${duration(now - credit.expiresAt)} ago` : `expires in ${duration(credit.expiresAt - now)}`;
  const expired = credit.expiresAt !== undefined && credit.expiresAt <= now;
  const status = canRedeem(credit, now) || expired ? "" : ` · ${credit.status}`;
  return `Reset${expiry ? ` · ${expiry}` : ""}${status}`;
}

const resetPageSize = 100;

/** Expand grant counts for display only; each row retains the full original grant.
 * Page the expansion so a large provider-reported count cannot allocate unbounded memory.
 */
function resetRows(grants: readonly ResetCredit[], provider: Account["provider"], now: number, offset: number) {
  const rows: { choice: string; credit: ResetCredit }[] = [];
  let skip = offset;
  for (const credit of grants) {
    const count = provider === "anthropic" ? credit.count : 1;
    if (skip >= count) { skip -= count; continue; }
    const take = Math.min(count - skip, resetPageSize + 1 - rows.length);
    for (let index = 0; index < take; index++) rows.push({ choice: creditChoice(credit, now, provider), credit });
    skip = 0;
    if (rows.length > resetPageSize) break;
  }
  return { hasMore: rows.length > resetPageSize, rows: rows.slice(0, resetPageSize) };
}

/** User-only command surface. Every reset path reaches a native confirmation. */
export class UsageMenu {
  /** Time and the service are injectable for offline menu tests. */
  constructor(private readonly usage: SubscriptionUsage, private readonly now: () => number) {}

  /** Refresh reads metadata only; no prompt, generation probe, or automatic reset. */
  async refresh(signal: AbortSignal): Promise<void> {
    await Promise.all([this.usage.refresh("codex", signal), this.usage.refresh("anthropic", signal)]);
  }

  /** Native selector dashboard, also available as a text notification without UI. */
  async open(ui: UsageUI, signal: AbortSignal, modelProvider: string | undefined): Promise<void> {
    await this.refresh(signal);
    const matching = () => viewsForModel(this.usage.getViews(), modelProvider);
    if (!ui.hasUI) { ui.notify(matching().map(view => renderView(view, this.now())).join("\n\n") || "No subscription quota monitor is available for the current model provider."); return; }
    while (!signal.aborted) {
      const views = this.usage.getViews();
      const accounts = (["codex", "anthropic"] as const).map(provider => {
        const view = views.find(v => v.provider === provider) ?? { provider };
        return { choice: renderSummary(view, this.now()), view };
      });
      const selected = await ui.select("Subscription usage", [...accounts.map(a => a.choice), "Close"]);
      if (!selected || selected === "Close") return;
      const account = accounts.find(a => a.choice === selected);
      if (!account) continue;
      const inventory = account.view.snapshot?.inventory;
      const hasResets = account.view.account && inventory && availableResets(inventory, this.now()) > 0;
      const action = await ui.select(renderView(account.view, this.now()), [...(hasResets ? ["Resets inventory"] : []), "Back"]);
      if (action === "Resets inventory" && hasResets && account.view.account) await this.accountInventory(ui, account.view.account, signal);
    }
  }

  /** Choose an account before showing its credits and any unconfirmed claim. */
  async inventory(ui: UsageUI, signal: AbortSignal): Promise<void> {
    await this.refresh(signal);
    if (!ui.hasUI) { ui.notify("Reset redemption requires a Pi UI with confirmation.", "warning"); return; }
    const choices = this.usage.getViews().filter(v => v.account).map(v => ({ label: v.account?.label ?? v.provider, account: v.account }));
    if (!choices.length) { ui.notify("No supported OAuth accounts are available.", "warning"); return; }
    const selected = await ui.select("Reset inventory · choose the account", [...choices.map(c => c.label), "Back"]);
    const account = choices.find(c => c.label === selected)?.account;
    if (account) await this.accountInventory(ui, account, signal);
  }

  private async accountInventory(ui: UsageUI, account: Account, signal: AbortSignal): Promise<void> {
    if (!ui.hasUI || signal.aborted) return;
    const view = this.usage.getViews().find(v => v.account?.key === account.key);
    const pending = await this.usage.getPending(account, signal);
    if (!pending.ok) { ui.notify(pending.error.message, "error"); return; }
    const snapshot: Snapshot | undefined = view?.snapshot;
    const inventory = snapshot?.inventory;
    const grants = inventory?.kind === "known" ? inventory.credits : [];
    const providerName = account.provider === "codex" ? "OpenAI" : "Anthropic";
    const retry = pending.value ? `Retry unconfirmed reset: ${pending.value.creditId} (same request ID)` : undefined;
    const title = [`${providerName} Resets`,
      ...(view?.error ? ["STALE inventory; eligibility will be checked again."] : []),
      ...(inventory?.kind === "unavailable" ? [inventory.message] : []),
    ].join("\n");
    let offset = 0;
    let selected: string | undefined;
    let selectedCredit: ResetCredit | undefined;
    while (!signal.aborted) {
      const page = resetRows(grants, account.provider, this.now(), offset);
      // Values identify rows independently of their identical visible labels.
      const values = page.rows.map((_row, index) => `reset:${index}`);
      const prefix = retry ? [retry] : [];
      const suffix = [...(offset > 0 ? ["Previous page"] : []), ...(page.hasMore ? ["Next page"] : []), "Back"];
      selected = await ui.select(title, [...prefix, ...values, ...suffix], [...prefix, ...page.rows.map(c => c.choice), ...suffix]);
      if (!selected || selected === "Back" || signal.aborted) return;
      if (selected === "Next page" && page.hasMore) { offset += resetPageSize; continue; }
      if (selected === "Previous page" && offset > 0) { offset -= resetPageSize; continue; }
      selectedCredit = page.rows[values.indexOf(selected)]?.credit;
      break;
    }
    if (signal.aborted) return;
    const creditId = selected === retry ? pending.value?.creditId : selectedCredit?.id;
    if (!creditId) return;
    if (selectedCredit && !canRedeem(selectedCredit, this.now())) { ui.notify("This credit is not currently usable.", "warning"); return; }
    const confirmationTime = this.now();
    const credit = selectedCredit ?? grants.find(c => c.id === creditId);
    const expiresAt = credit?.expiresAt;
    const expiry = expiresAt === undefined ? (account.provider === "anthropic" ? "" : " whose expiry is unknown") : expiresAt > confirmationTime
      ? ` that expires in ${duration(expiresAt - confirmationTime)}` : ` that expired ${duration(confirmationTime - expiresAt)} ago`;
    const sooner = expiresAt !== undefined && grants.some(c => c.id !== creditId &&
      canRedeem(c, confirmationTime) && c.expiresAt !== undefined && c.expiresAt < expiresAt);
    const yes = sooner ? "Yes (another reset expires sooner)" : "Yes";
    const question = `${providerName} Reset Redeem\n\nAre you sure you want to redeem this banked reset${expiry}?${selected === retry ? "\nThis retries the previous claim with its saved request ID." : ""}`;
    const confirmed = await ui.select(question, [yes, "No"]) === yes;
    if (!confirmed || signal.aborted) return;
    const result = await this.usage.redeem(account, creditId, signal, selectedCredit ? { count: selectedCredit.count } : {});
    if (!result.ok) { ui.notify(result.error.message, "error"); return; }
    const outcome = { reset: "Reset redeemed.", alreadyRedeemed: "This reset was already redeemed.", nothingToReset: "No reset was needed.", noCredit: "The provider reports no usable credit." }[result.value];
    ui.notify(outcome, result.value === "reset" || result.value === "alreadyRedeemed" ? "info" : "warning");
    const updated = this.usage.getViews().find(v => v.account?.key === account.key);
    if (updated?.error) ui.notify(updated.error.message, "warning");
  }
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "./agents.ts";

const DESTRUCTIVE_PATTERNS = [
  /(^|[;&|()\s])rm(\s|$)/i,
  /(^|[;&|()\s])rmdir(\s|$)/i,
  /(^|[;&|()\s])mv(\s|$)/i,
  /(^|[;&|()\s])cp(\s|$)/i,
  /(^|[;&|()\s])mkdir(\s|$)/i,
  /(^|[;&|()\s])touch(\s|$)/i,
  /(^|[;&|()\s])chmod(\s|$)/i,
  /(^|[;&|()\s])chown(\s|$)/i,
  /(^|[;&|()\s])ln(\s|$)/i,
  /(^|[;&|()\s])tee(\s|$)/i,
  /(^|[;&|()\s])truncate(\s|$)/i,
  /(^|[;&|()\s])dd(\s|$)/i,
  /(^|[;&|()\s])shred(\s|$)/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\b(git\s+(?:-C\s+\S+\s+)*)(add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|stash|cherry-pick|revert|tag|init|clone|worktree\s+(add|remove|move|prune))\b/i,
  /\b(npm\s+)(install|uninstall|update|ci|link|publish|dedupe|prune)\b/i,
  /\b(yarn\s+)(add|remove|install|publish|upgrade)\b/i,
  /\b(pnpm\s+)(add|remove|install|update|publish|prune)\b/i,
  /\b(bun\s+)(add|remove|install|update)\b/i,
  /\b(pip\s+)(install|uninstall)\b/i,
  /\b(apt|apt-get|dnf|yum|pacman|brew)\s+(install|remove|purge|update|upgrade|uninstall)\b/i,
  /(^|[;&|()\s])sudo(\s|$)/i,
  /(^|[;&|()\s])su(\s|$)/i,
  /(^|[;&|()\s])kill(all)?(\s|$)/i,
  /(^|[;&|()\s])pkill(\s|$)/i,
  /\bcurl\b.*\s(-o|--output|--remote-name|-O)\b/i,
  /\bwget\b.*\s(-O|--output-document)\s+(?!-)\S+/i,
  /\b(systemctl\s+)(start|stop|restart|enable|disable)\b/i,
  /\b(service\s+\S+\s+)(start|stop|restart)\b/i,
  /(^|[;&|()\s])(vi|vim|nvim|nano|emacs|code|subl)(\s|$)/i,
];

const SAFE_PREFIX_PATTERNS = [
  /^\s*(cat|head|tail|less|more|grep|find|ls|pwd|echo|printf|wc|sort|uniq|diff|file|stat|du|df|tree|which|whereis|type|env|printenv|uname|whoami|id|date|cal|uptime|ps|top|htop|free|jq|awk|rg|fd|bat|eza)\b/i,
  /^\s*sed\s+-n\b/i,
  /^\s*git\s+(?:-C\s+\S+\s+)*(status|log|diff|show|branch|remote|config\s+--get|ls-files|ls-tree|grep|describe|rev-parse|cat-file|show-ref)\b/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
  /^\s*yarn\s+(list|info|why|audit)\b/i,
  /^\s*pnpm\s+(list|view|info|why|audit|outdated)\b/i,
  /^\s*bun\s+(--version|pm\s+ls)\b/i,
  /^\s*node\s+--version\b/i,
  /^\s*(python|python3)\s+--version\b/i,
  /^\s*curl\s+(-[fsSLI]*\s+)*https?:\/\//i,
  /^\s*wget\s+(-[qSO-]*\s+)*https?:\/\//i,
];

export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;

  // Permit simple environment assignments before the real command.
  const withoutAssignments = trimmed.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)*/, "");
  return SAFE_PREFIX_PATTERNS.some((pattern) => pattern.test(withoutAssignments));
}

export function createPermissionGuard(agent: AgentDefinition) {
  return function permissionGuard(pi: ExtensionAPI): void {
    pi.on("tool_call", async (event) => {
      if ((event.toolName === "edit" && agent.permissions.edit === "deny") ||
          (event.toolName === "write" && agent.permissions.write === "deny")) {
        return { block: true, reason: `${agent.name}: ${event.toolName} is denied for this subagent.` };
      }

      if (event.toolName !== "bash") return undefined;

      if (agent.permissions.bash === "deny") {
        return { block: true, reason: `${agent.name}: bash is denied for this subagent.` };
      }

      if (agent.permissions.bash !== "readonly") return undefined;

      const command = typeof event.input.command === "string" ? event.input.command : "";
      if (!isReadOnlyCommand(command)) {
        return {
          block: true,
          reason: `${agent.name}: bash is read-only. Use read/grep/find/ls or a safe inspection command. Blocked command: ${command}`,
        };
      }

      return undefined;
    });
  };
}

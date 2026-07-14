// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now

import type { PluginAPI } from "@ampcode/plugin"

const gitEnvironmentPrefix =
  "export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no\n"

const noVerifyPattern = /--no-verify\b/

const blockReason =
  "BLOCKED: --no-verify is not allowed. Git hooks exist for a reason. " +
  "Do not attempt to bypass them. Fix the underlying hook failure or ask the user for help."

export default function gitInterceptor(amp: PluginAPI) {
  amp.on("tool.call", (event) => {
    const shellCommand = amp.helpers.shellCommandFromToolCall(event)
    if (!shellCommand?.command || !shellCommand.command.includes("git")) {
      return { action: "allow" }
    }

    if (noVerifyPattern.test(shellCommand.command)) {
      return { action: "reject-and-continue", message: blockReason }
    }

    const commandKey = Object.entries(event.input).find(
      ([, value]) => value === shellCommand.command,
    )?.[0]

    if (!commandKey) {
      amp.logger.log("Could not locate shell command input; allowing it unchanged")
      return { action: "allow" }
    }

    return {
      action: "modify",
      input: {
        ...event.input,
        [commandKey]: gitEnvironmentPrefix + shellCommand.command,
      },
    }
  })
}

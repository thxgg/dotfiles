# TODO

## Done

- [x] Review if any of the non-agent-harness things from Dillon's dotfiles are worth transferring
- [x] Add Grok 4.5 and Fable 5 as a scoped model for testing via opencode
- [x] Fix repo_cache error from last sessions
- [x] Review the subagent model + thinking effort matrix
- [x] Check for the Pi todos extension usage
- [x] Check if any changes from the last few releases of Pi fixes our headaches with 1M context and Fast versions of GPT-5.6-Sol
- [x] Improve the recap Pi extension and make it always run upon losing focus of the session (either via Pi events or herdr events)
- [x] Re-clean the todos
- [x] Commit and push
- [x] Test new recap extension
- [x] Sometimes subagent panes/windows in herdr steal the focus (I get randomly navigated and focused to them)
- [x] Look into how Claude Code makes it possible to continue the conversation while waiting for subagent (it runs them like shells or something and then reports progress so far + what it's waiting on + continues once the subagent reports) - it can look through my claude code sessions to try to reverse engineer it if it isn't common knowledge. There is also a Claude Code source code leak here that you can reference (not sure if this feature was implemented or is up to date with what is available now as this is an older leak - 31st March 2026)
- [x] Check if the Oracle agent is not meant as a second opinion according to Amp's subagents
- [x] Review the dotfiles for anything potentially leaked (current + git history)
- [x] Review subagent incident:

```
Agent run reviewer background
 ✗ reviewer failed agent-be1fc9fe herdr pi-reviewer-be1fc9fe w12:t6M/w12:pDS
 Failed to launch Herdr subagent: Child bridge did not report startup within 30
 seconds.
```

The actual subagent kept running successfully: /tmp/dotfiles-secret-audit.NKw7sP (detached) • reviewer:be1fc9fe
- [x] Add https://github.com/iFurySt/open-codex-computer-use
- [x] Add pgcli and check it out (e.g. if it solves my papercut with broken autocompletion in psql after the first set statement, or a comma)
- [x] Create an insights skill that reviews sessions and suggests improvements to prompts/AGENTS.md/system prompt/etc.
- [x] Personal Artifacts cloud (on my server avail on my Tailscale net, served from a central index). See how Claude Code has theirs architectured + their skill artifact-design and dataviz

## Current

- [ ] Setup executor on other machine
  - [ ] Figure out if it will solve the issue of a billion MCP processes running when I run 3-5 agents at the same time

## Backlog

- [ ] Figure out how to orchestrate my Pi, so it is aware of my server, laptop, and phone (things on my Tailscale net) and is able to work with them
  - [ ] The Artifacts thingy is visible and used seemlessly
  - [ ] Cron/scheduled/"cloud" jobs are sent to my server
  - [ ] Maybe my phone can receive app builds or something like that
  - [ ] We have knowledge of sessions and work on other machines
  - [ ] Basically Pi is the control plan and the whole Tailscale net of devices is my fleet

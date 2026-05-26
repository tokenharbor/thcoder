// THcoder default slash commands + tool permissions. Seeded into fresh
// configs (config.ts) and force-merged onto existing ones (provider.ts /
// config load), so users get them without manual setup.
//
// Commands are prompt templates: invoking /review sends the template to
// the model, which — under th-orchestra — gets classified to the right
// role (review→reviewer, "fix the failing test"→debugger, etc.). `$ARGUMENTS`
// is replaced with whatever the user types after the command.

export const TH_COMMANDS: Record<string, { template: string; description: string }> = {
  review: {
    description: "Review the current changes for bugs, edge cases, and security",
    template:
      "Review the current changes (or $ARGUMENTS if I name a file/area) for bugs, edge cases, off-by-ones, security issues, and missing error handling. Cite file:line. Don't change code unless I explicitly ask — surface issues.",
  },
  test: {
    description: "Run tests and fix any failures at the root cause",
    template:
      "Run the project's tests$ARGUMENTS. If any fail, find the root cause (read the error/stack trace, locate the exact file:line), fix it, and re-run to prove it's resolved.",
  },
  commit: {
    description: "Stage changes and write a conventional-commit message",
    template:
      "Stage the current changes and write a concise Conventional Commits message summarizing them, then commit. $ARGUMENTS",
  },
  optimize: {
    description: "Find and apply the highest-impact optimization",
    template:
      "Analyze the performance of $ARGUMENTS (or the code I last touched). Identify the highest-impact bottleneck, explain why, and apply the optimization. Keep behavior identical.",
  },
  explain: {
    description: "Explain how some code works for a new contributor",
    template:
      "Explain how $ARGUMENTS works, at a level useful for a new contributor: the entry points, the data flow, and any non-obvious decisions.",
  },
  plan: {
    description: "Produce a step-by-step implementation plan (no edits)",
    template:
      "Produce a concrete step-by-step plan for: $ARGUMENTS. List the files to read, the changes to make, and how to verify. Do not edit code yet — just the plan.",
  },
}

// Safe-but-usable defaults: file reads/searches flow freely; edits are
// allowed (it's a coding agent); shell + network ask first.
export const TH_PERMISSION: Record<string, "ask" | "allow" | "deny"> = {
  edit: "allow",
  bash: "ask",
  webfetch: "ask",
}

// Primary agent modes shown in the tab-cycle. opencode already ships
// `build` (default) and `plan` (read-only) as primary; we add `yolo` —
// full autonomy, every tool allowed, no confirmation prompts. Three
// visible modes: Build · Plan · Yolo.
export const TH_AGENTS: Record<
  string,
  {
    mode: "primary" | "subagent" | "all"
    description: string
    prompt?: string
    color?: string
    permission?: Record<string, "ask" | "allow" | "deny">
  }
> = {
  yolo: {
    mode: "primary",
    description: "Yolo mode — full autonomy. Every tool allowed, no confirmations.",
    // Build is green, Plan is orange → Yolo is red (theme error color).
    color: "error",
    prompt:
      "You are in YOLO mode. Operate with full autonomy: make decisions and execute edits, shell commands, and web fetches WITHOUT pausing to ask for confirmation. Keep working until the task is genuinely complete or you hit a real blocker that needs the user. Be decisive and concise.",
    permission: { edit: "allow", bash: "allow", webfetch: "allow" },
  },
}

// THcoder startup update check (opt-in prompt, never silent).
//
// Runs at the top of src/index.ts — the SAME clean pre-TUI context as the
// browser-login (th-auth) — NOT inside the TUI command handler. That
// matters: once the TUI takes over the terminal, an interactive prompt
// can't get a usable stdin (clack's confirm silently cancelled there,
// which is why earlier builds "skipped" the check). Here stdin is a plain
// TTY, so a Node readline y/N works.
//
// On every interactive launch: ask the gateway for the latest version,
// compare, and if newer PROMPT (y/N) to update → run the install one-liner.
// Guards: TTY-only, skipped for non-interactive subcommands (serve/run/…),
// 5s network timeout, every error swallowed, opt out with
// THCODER_NO_UPDATE_CHECK=1.

import readline from "node:readline"
import { spawnSync } from "node:child_process"
import semver from "semver"
import { THCODE_VERSION } from "@/th-version"

const VERSION_URL = "https://tokenharbor.ai/api/cli/latest-version"
const INSTALL_SH = "curl -fsSL https://tokenharbor.ai/install | bash"
const INSTALL_PS = "irm https://tokenharbor.ai/install.ps1 | iex"

// Subcommands that must never trigger an interactive update prompt.
const NON_INTERACTIVE = new Set([
  "--help", "-h", "help", "--version", "-v", "version",
  "upgrade", "uninstall", "generate", "stats", "models", "providers",
  "serve", "acp", "github", "pr", "import", "export", "session", "db",
  "debug", "run", "--prompt", "-p",
])

function shouldCheck(argv: string[]): boolean {
  if (process.env.THCODER_NO_UPDATE_CHECK) return false
  if (!process.stdout.isTTY || !process.stdin.isTTY) return false
  for (const a of argv) if (NON_INTERACTIVE.has(a)) return false
  return true
}

async function fetchLatest(): Promise<string | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch(VERSION_URL, { signal: ctrl.signal })
    if (!r.ok) return null
    const d = (await r.json()) as { version?: string | null }
    return typeof d?.version === "string" ? d.version : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
    rl.question(question, (ans) => {
      rl.close()
      resolve(/^y(es)?$/i.test(ans.trim()))
    })
  })
}

/**
 * Check for a newer THcoder and, if found, prompt to update. Call once at
 * startup with the process argv. No-ops on non-TTY / non-interactive
 * subcommands / any error — never blocks or breaks launch.
 */
export async function maybePromptUpdate(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    if (!shouldCheck(argv)) return

    const latest = await fetchLatest()
    if (!latest || !semver.valid(latest) || !semver.valid(THCODE_VERSION)) return
    if (!semver.gt(latest, THCODE_VERSION)) return

    process.stderr.write(`\nTHcoder ${latest} is available (you have ${THCODE_VERSION}).\n`)
    const yes = await askYesNo("Update now? [y/N] ")
    if (!yes) return

    if (process.platform === "win32") {
      process.stderr.write(`Run this in PowerShell to update:\n  ${INSTALL_PS}\n`)
      return
    }

    process.stderr.write("Updating — running the Token Harbor install script…\n")
    const res = spawnSync("bash", ["-c", INSTALL_SH], { stdio: "inherit" })
    if (res.status === 0) {
      process.stderr.write(`Updated to ${latest}. Relaunch thcoder to use it.\n`)
      process.exit(0)
    }
    process.stderr.write(`Update didn't complete. Run manually:\n  ${INSTALL_SH}\n`)
  } catch {
    // Never let the update check interfere with launching.
  }
}

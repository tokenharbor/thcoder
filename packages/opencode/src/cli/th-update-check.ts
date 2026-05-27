// THcoder startup update check (opt-in prompt, never silent).
//
// On EVERY interactive launch we ask the Token Harbor gateway for the
// latest published version (it owns the version source), compare to this
// build, and if a newer one exists, ASK the user whether to update — then
// run the official install one-liner. Deliberately conservative:
//   - only when stdin+stdout are TTYs (skipped for pipes / one-shot / CI)
//   - 2s network timeout, and EVERY error is swallowed — the check can
//     never block or break startup
//   - opt out entirely with THCODER_NO_UPDATE_CHECK=1
//
// We don't hot-swap the running binary; on "yes" we run the installer and
// ask the user to relaunch (a binary can't safely replace itself mid-run).

import { spawnSync } from "node:child_process"
import semver from "semver"
import * as prompts from "@clack/prompts"
import { THCODE_VERSION } from "@/th-version"

const VERSION_URL = "https://tokenharbor.ai/api/cli/latest-version"
const INSTALL_SH = "curl -fsSL https://tokenharbor.ai/install | bash"
const INSTALL_PS = "irm https://tokenharbor.ai/install.ps1 | iex"

async function fetchLatest(): Promise<string | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 2000)
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

/**
 * Check for a newer THcoder and, if found, prompt to update. Runs on every
 * interactive launch (no throttle). Safe to call unconditionally — it
 * no-ops on non-TTY / any error.
 */
export async function maybePromptUpdate(): Promise<void> {
  try {
    if (process.env.THCODER_NO_UPDATE_CHECK) return
    if (!process.stdout.isTTY || !process.stdin.isTTY) return

    const latest = await fetchLatest()
    if (!latest || !semver.valid(latest) || !semver.valid(THCODE_VERSION)) return
    if (!semver.gt(latest, THCODE_VERSION)) return

    const answer = await prompts.confirm({
      message: `THcoder ${latest} is available (you have ${THCODE_VERSION}). Update now?`,
      initialValue: false,
    })
    if (prompts.isCancel(answer) || !answer) return

    if (process.platform === "win32") {
      // The bash one-liner won't run on Windows; hand the user the PS one.
      prompts.log.info(`Run this in PowerShell to update:\n  ${INSTALL_PS}`)
      return
    }

    prompts.log.info("Updating — running the Token Harbor install script…")
    const res = spawnSync("bash", ["-c", INSTALL_SH], { stdio: "inherit" })
    if (res.status === 0) {
      prompts.log.success(`Updated to ${latest}. Relaunch thcoder to use it.`)
      process.exit(0)
    }
    prompts.log.warn(`Update didn't complete. Run manually:\n  ${INSTALL_SH}`)
  } catch {
    // Never let the update check interfere with launching.
  }
}

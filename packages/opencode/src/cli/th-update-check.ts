// THcoder startup update check (opt-in prompt, never silent).
//
// On an interactive launch we ask the Token Harbor gateway for the latest
// published version (it owns the version source), compare to this build,
// and if a newer one exists, ASK the user whether to update — then run the
// official install one-liner. Deliberately conservative:
//   - only when stdin+stdout are TTYs (skipped for pipes / one-shot / CI)
//   - throttled to once per day via a stamp file
//   - 2s network timeout, and EVERY error is swallowed — the check can
//     never block or break startup
//   - opt out entirely with THCODER_NO_UPDATE_CHECK=1
//
// We don't hot-swap the running binary; on "yes" we run the installer and
// ask the user to relaunch (a binary can't safely replace itself mid-run).

import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { spawnSync } from "node:child_process"
import semver from "semver"
import * as prompts from "@clack/prompts"
import { THCODE_VERSION } from "@/th-version"

const VERSION_URL = "https://tokenharbor.ai/api/cli/latest-version"
const INSTALL_SH = "curl -fsSL https://tokenharbor.ai/install | bash"
const INSTALL_PS = 'irm https://tokenharbor.ai/install.ps1 | iex'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // once per day

function stampFile(): string {
  const base =
    process.env.XDG_STATE_HOME ||
    (process.platform === "win32"
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
      : path.join(os.homedir(), ".local", "state"))
  return path.join(base, "thcoder", "last-update-check")
}

async function recentlyChecked(file: string): Promise<boolean> {
  try {
    const last = Number((await fs.readFile(file, "utf8")).trim())
    return Number.isFinite(last) && Date.now() - last < CHECK_INTERVAL_MS
  } catch {
    return false
  }
}

async function stamp(file: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, String(Date.now()))
  } catch {
    // ignore — worst case we re-check next launch
  }
}

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
 * Check for a newer THcoder and, if found, prompt to update. Safe to call
 * unconditionally at startup — it no-ops on non-TTY / throttle / any error.
 */
export async function maybePromptUpdate(): Promise<void> {
  try {
    if (process.env.THCODER_NO_UPDATE_CHECK) return
    if (!process.stdout.isTTY || !process.stdin.isTTY) return

    const file = stampFile()
    if (await recentlyChecked(file)) return
    // Stamp BEFORE the network call so a flaky network doesn't make us
    // re-prompt every launch within the day.
    await stamp(file)

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

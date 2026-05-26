// THcoder fork: startup auto-upgrade is DISABLED.
//
// Upstream calls Installation.upgrade() for patch-level releases,
// pulling a binary from sst/opencode's releases. That would silently
// replace our rebranded fork at every startup, wiping every change in
// this repo (banner, defaults, TH auth, disabled upgrade itself).
//
// The Aider fork tried the same fix later and learned the hard way —
// see memory project_thpy_pivot_aborted.md. Never again.

export async function upgrade() {
  return
}

import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"

// THcoder fork: the upstream `upgrade` command pulls a release from
// sst/opencode and replaces the running binary. That would silently
// overwrite our fork with stock opencode and wipe every rebrand,
// default-config seed, and auth path. Hard-disabled — re-installing
// THcoder is done by re-running the official Token Harbor install
// script, not from inside the binary itself.

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "(disabled) re-install THcoder via the Token Harbor install script",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", { type: "string" })
      .option("method", { alias: "m", type: "string" })
  },
  handler: async (_args: { target?: string; method?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    prompts.log.warn(
      "In-binary upgrade is disabled in THcoder. Re-run the official Token Harbor"
        + " install script to update — it ships a vetted build that won't replace"
        + " your config or auth state.",
    )
    prompts.outro("Done")
  },
}

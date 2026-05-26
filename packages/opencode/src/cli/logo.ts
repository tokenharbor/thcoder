// THcoder splash wordmark. The scrollback entry/exit splash (run/splash.ts)
// renders logo.left[i] then logo.right[i] per row. We use a clean text
// wordmark instead of the old pixel-block mosaic (which rendered garbled
// and overlapped the migration output). _ ^ ~ , are shadow-mark glyphs
// consumed by cells() — plain text uses none.
export const logo = {
  left: ["Token Harbor"],
  right: [" Coder"],
}

// Compact exit badge shown in the scrollback. run/splash.ts uses
// go.right.slice(1) as the mark, so row 0 is intentionally blank.
export const go = {
  left: ["", "TH"],
  right: ["", "TH"],
}

export const marks = "_^~,"

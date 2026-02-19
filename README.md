# Desmos Scientific LaTeX Copier

This repo now includes a ready-to-install userscript:

- `desmos-latex-copy.user.js`

It adds a **Copy LaTeX** button on `https://www.desmos.com/scientific` and a hotkey:

- `Alt+Shift+L`

When used, it attempts to collect all calculator expressions in LaTeX form and copy them to your clipboard (one expression per line).

## Install (Tampermonkey / Violentmonkey)

1. Install a userscript manager extension (Tampermonkey or Violentmonkey).
2. Create a new script.
3. Paste the contents of `desmos-latex-copy.user.js`.
4. Save and enable it.
5. Open Desmos Scientific Calculator and click **Copy LaTeX**.

## Notes

- The script prioritizes ordered Desmos APIs first.
- Deep fallback now finds only the node with the highest `_stack` value, then iterates expressions on that node.
- It filters likely incomplete partial captures (e.g., unbalanced braces or trailing operators).
- It attempts to include evaluated results in the copied output (formatted as `latex = value` when available).
- It logs where each copied node was found via `console.table(...)`.
- If no expression is found, it shows a red toast.
- Copied content is plain text with LaTeX lines separated by newlines.

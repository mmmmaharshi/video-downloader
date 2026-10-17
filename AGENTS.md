# Agent Instructions

- Follow all guidelines defined in @CODING_STANDARDS.md for every code change, review, and architectural decision in this repository.
- Use Bun (https://bun.sh/llms.txt) as the runtime and package manager for this project.

## Styling

- HeroUI v3 (`@heroui/react`, `@heroui/styles`) on Tailwind CSS v4. Compound components, `onPress` handlers, semantic variants. No provider.
- Dark theme only: `<html class="dark" data-theme="dark">` in `app/root.tsx`. Use HeroUI theme tokens (`bg-background`, `text-muted`, …), no custom colors.
- Typeface: Geist Pixel Variable via `@fontsource-variable/geist-pixel`, set as `--font-sans` in `app/app.css`.
- Layout with standard Tailwind utilities only. No custom CSS beyond the two imports and the font token.
- Before adding custom styles or component logic, search the HeroUI docs first (MCP `heroui-react` server in `opencode.json`, or `node scripts/*` in the `heroui-react` skill). Only hand-roll what the docs don't cover.

## Workflow

- Don't run the dev server. Verify with `bun run verify`.
- Production deploys from the CI `deploy` job, after `verify` passes — not from the push. `vercel.json` turns Vercel's own git deploy off for `master`, so a red run ships nothing.
- Don't push without the user's permission. Commit locally; the user pushes.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `mmmmaharshi/video-downloader`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: the domain doc is `CONTEXT.md` at the root — glossary and seams — plus `docs/adr/`. There is no `GLOSSARY.md` (ADR 0002). See `docs/agents/domain.md`.

# Ultracite (oxlint + oxfmt)

- `bun run check` verifies lint + format; `bun run fix` repairs.
- Don't disable rules to make check pass. When a rule conflicts with real semantics, the exception is an inline disable with a stated reason: `// eslint-disable-next-line <rule> -- why`.
- The vendored anti-slop preset (`ultracite/oxlint/anti-slop`, 18 rules at error) is on: every `as` assertion needs a `SAFETY:` comment stating the checked invariant.
- The `shadcn` preset (Tailwind design-system class rules) and the `gdp` preset (no type assertions anywhere outside `proofs/`, `as const` excepted — parse at boundaries instead) are also on.
- Keep oxlint's `--type-aware` off; doctor expects the stock setup otherwise.

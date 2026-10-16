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

- Don't run the dev server. Verify with `bun run typecheck`, `bun run build`, and `bun test` instead.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `mmmmaharshi/video-downloader`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

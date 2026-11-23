# Agent Instructions

- Always respond to the user with `$simple-english` `$i-have-adhd`.
- Follow all guidelines defined in @CODING_STANDARDS.md for every code change, review, and architectural decision in this repository.
- Use Bun (https://bun.sh/llms.txt) as the runtime and package manager for this project.
- The stack is mid-migration to AFE on Cloudflare (see `docs/adr/0003-afe-on-cloudflare-with-scandinavian-ui.md`). Do not reintroduce the pieces ADR-0003 retires.

## Styling

- HeroUI v3 is frozen: fix bugs in the current UI, but build no new HeroUI components and extend no HeroUI theme tokens.
- New UI work targets Foldkit with the `$scandinavian-design` system: near-black canvas, neutral alpha ink, restraint, no decorative color. One primary action per view. Left-align text.
- Until the Foldkit rebuild lands, keep the dark theme (`<html class="dark" data-theme="dark">` in `app/root.tsx`) and the Geist Pixel Variable typeface (`--font-sans` in `app/app.css`).
- Layout with standard Tailwind utilities only. No custom CSS beyond the two imports and the font token.

## Effect

- New server logic is an Effect 4 program with dependencies as a Layer and failures as a plain tagged union. Follow the `rumble-effect.ts` pattern: `FetchDeps` service, `Effect.provide` at the seam, `rumbleErrorMessage`-style mapper back to the legacy contract.
- Never change a seam's user-facing contract in the porting commit: `resolve()` still throws `Error`, `Transfer.proxy` still throws `Response` (ADR-0001). Error-currency changes are their own ADR.
- Test Effect code with `Effect.runPromise` / `Effect.flip` and injected Layers under `bun:test`. Keep the legacy promise tests green as equivalence proof.

## Workflow

- Don't run the dev server. Verify with `bun run verify`.
- Production deploys from the CI `deploy` job, after `verify` passes — not from the push. `vercel.json` turns Vercel's own git deploy off for every branch, so a red run ships nothing. Cloudflare plus Alchemy is the declared deploy target (ADR-0003); until the Alchemy stack lands, declare no infrastructure by hand.
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

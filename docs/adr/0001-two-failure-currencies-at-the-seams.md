# ADR-0001: Two failure currencies at the seams

Status: accepted

## Context

The two deep modules answer failure differently. `MediaResolver.resolve` throws `Error`, which the home action catches and renders as an inline error card. `Transfer.proxy` throws `Response`, which the download loader lets bubble to the root `ErrorBoundary`.

## Decision

Keep both. The split follows the surfaces: a form result is data the page renders inline, a byte-stream endpoint failure is an HTTP response the generic boundary turns into a page.

## Consequences

Future architecture reviews should not re-suggest unifying the two idioms unless a caller needs to handle both, which none currently does.

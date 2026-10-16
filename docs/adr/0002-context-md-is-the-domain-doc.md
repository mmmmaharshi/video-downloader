# ADR-0002: CONTEXT.md is the domain doc

Status: accepted

## Context

The repo keeps its glossary (SourceUrl, Shortcode, VideoAsset, MediaResolver, Transfer, Preview, DownloadLink) and its seam map in `CONTEXT.md` at the root. There is no `GLOSSARY.md`.

## Decision

`CONTEXT.md` stays the single domain doc. Creating a `GLOSSARY.md` beside it would leave two overlapping glossaries, against DRY.

## Consequences

Skills that conventionally read `GLOSSARY.md` should read `CONTEXT.md` in this repo instead. `docs/agents/domain.md` carries that pointer.

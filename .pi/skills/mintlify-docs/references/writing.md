# Writing Mintlify pages

## Frontmatter

`title` and `description` are effectively mandatory (navigation, SEO, and AI
indexing all use them). Everything else as needed:

```yaml
---
title: "Configure the Slack backend"
description: "Set up Socket Mode tokens and channel permissions for the bot"
sidebarTitle: "Slack setup"        # shorter sidebar label
icon: "slack"                      # Font Awesome / Lucide / Tabler name, URL, or file path
tag: "NEW"                         # badge next to the title
keywords: ["slack", "socket mode"] # extra search terms
---
```

Other properties: `mode` (`"wide"` — no side panel; `"center"`; `"custom"` —
navbar only; `"frame"`), `hidden` (off the sidebar, still reachable by URL),
`noindex` (out of search/sitemap/AI context), `searchable`, `boost` (search
ranking multiplier), `deprecated` (deprecation label), `url` (sidebar entry
that links externally), `timestamp`, `related`, `hideFooterPagination`.

## Content types

Assign the type before writing — it shapes length, tone, and structure:

| Type | Reader | Shape |
|---|---|---|
| Tutorial | beginner | one complete path to a working result; sequential steps; celebrate milestones; no option-surveys |
| How-to | knows the basics | task-titled ("Deploy to staging"), prerequisites up front, numbered steps, no theory |
| Reference | experienced, looking something up | complete and accurate above all; tables; every parameter with type and default |
| Explanation | anyone | opens with the question it answers; context, trade-offs, why it's built this way |

One type per page; link between types (how-to → concept for background,
reference → explanation for rationale). Start a new docs area with how-to
guides + reference; add tutorials/explanations where users actually struggle.

## Writing standards

- Second person ("you"), active voice, present tense.
- Procedural content states prerequisites first.
- Every command/code sample tested or verified against the source — never
  invent flags or behavior; when unsure, read the code or say so.
- Internal links are root-relative paths (`/guides/setup`), never absolute
  URLs to the docs site itself. Code blocks get a language tag; images get alt
  text.
- Match the style of neighboring pages; smallest reasonable change first.
- Search for existing coverage before writing a new page — extend, don't
  duplicate.

## Reusable snippets

Shared fragments live in `snippets/` (never rendered as pages):

```mdx
import EnvSetup from '/snippets/env-setup.mdx';

<EnvSetup />
```

Use for anything repeated on 2+ pages (setup blocks, warnings, version notes).

## Quality gates before committing

```bash
mint validate && mint broken-links
mint deslop <changed files>   # catches AI-sounding prose in generated drafts
mint a11y                     # alt text, contrast
```

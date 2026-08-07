---
name: mintlify-docs
description: Structure, write, build, and maintain documentation sites with Mintlify (docs.json + MDX pages). Use when creating or scaffolding a docs site, adding or editing docs pages, reorganizing docs navigation, reviewing docs quality, or validating and deploying Mintlify documentation.
---

# Mintlify Docs

Mintlify is a docs-as-code platform: a repo with one `docs.json` (site config +
navigation) and MDX pages, deployed automatically on git push once the repo is
connected in the [Mintlify dashboard](https://dashboard.mintlify.com).

Anatomy of a docs repo:

```
docs.json          # site config: name, theme, colors, navigation — the source of truth
index.mdx          # landing page; every page is an .mdx file with YAML frontmatter
guides/*.mdx
reference/*.mdx
snippets/*.mdx     # reusable content, imported by pages, never rendered standalone
images/, logo/     # static assets
```

Every page needs frontmatter with at least `title` and `description`. A page
only appears in the sidebar if it is listed in `docs.json` navigation (path
without the `.mdx` extension).

## Workflows

### Scaffold a new docs site

Copy [assets/starter/](assets/starter/) into the target directory and adapt
`name`, `colors`, and navigation in `docs.json`. Alternatively `mint new`
generates Mintlify's official starter. Then fill pages per the structure below.

### Structure content

Decide each page's type before writing — it dictates structure and tone:

- **Tutorial** — hands-on first success for beginners; one complete path, minimal choices.
- **How-to guide** — a specific task for someone who knows the basics; steps, no theory.
- **Reference** — complete, accurate, scannable lookup (tables, parameters, defaults).
- **Explanation** — the "why": architecture, trade-offs, design decisions.

Don't mix types on one page; link between them instead. Most internal docs need
how-to guides and reference first. Group pages in `docs.json` by user goal, not
by internal team structure. Use tabs for genuinely separate audiences/products,
groups within a tab for topics. Full navigation schema: [references/docs-json.md](references/docs-json.md).

### Write pages

- Frontmatter on every page; second-person voice; prerequisites stated up front
  for procedural content; relative paths for internal links (`/guides/setup`,
  never absolute URLs to the site itself).
- Use MDX components where they genuinely aid scanning — `<Steps>` for
  procedures, `<Note>/<Warning>` callouts, `<CodeGroup>` for multi-language
  examples, ` ```mermaid ` for diagrams. Cheatsheet: [references/components.md](references/components.md).
- Only include commands/code you have actually run or verified against the
  codebase. Never invent flags, options, or behavior — check the source.
- Search existing pages before adding new ones; extend rather than duplicate.
  Repeated fragments go in `snippets/` and get imported.
- Frontmatter/page options and writing standards: [references/writing.md](references/writing.md).

### Validate

CLI (`npm i -g mint`, Node >= 20.17; `mint update` to upgrade):

```bash
mint dev                # live preview at localhost:3000 (run where docs.json lives)
mint validate           # strict build validation — run before every commit/PR
mint broken-links       # internal links; add --check-anchors / --check-external
mint a11y               # accessibility checks (alt text, contrast)
mint format             # canonical MDX formatting
mint deslop             # flags AI-sounding prose — run on generated drafts
```

### Deploy

Push to the production branch → auto-deploy to `https://<project>.mintlify.site`
(requires the Mintlify GitHub app connected to the repo, one-time dashboard
setup). PRs get preview deployment URLs. Never merge without `mint validate`
passing.

### Maintain

When code changes, update the affected pages in the same PR. Periodically:
`mint broken-links`, prune pages for features that no longer exist, and check
that navigation still matches how users approach the product. Prefer the
smallest change that fixes the problem; big restructures need redirects
(`redirects` in `docs.json`) so old URLs keep working.

## Looking things up

- **Mintlify reference is available live** through the `mintlify-docs` MCP
  connector (via the `mcp` tool): search the official docs for any docs.json
  property, component, or CLI detail instead of guessing.
- Any Mintlify docs page is fetchable as markdown by appending `.md` to its
  URL; the full page map is at <https://mintlify.com/docs/llms.txt>.

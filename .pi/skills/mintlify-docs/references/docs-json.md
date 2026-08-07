# docs.json reference (essentials)

Schema: `https://mintlify.com/docs.json` — editors and `mint validate` check
against it. Full property reference: <https://www.mintlify.com/docs/organize/settings-reference.md>.

Required fields: `name`, `theme`, `colors.primary`, `navigation`.

## Minimal working config

```json
{
  "$schema": "https://mintlify.com/docs.json",
  "name": "Acme Internal Docs",
  "theme": "mint",
  "colors": { "primary": "#0D9373" },
  "favicon": "/favicon.svg",
  "logo": { "light": "/logo/light.svg", "dark": "/logo/dark.svg" },
  "navigation": {
    "groups": [
      { "group": "Overview", "pages": ["index"] }
    ]
  },
  "navbar": {
    "links": [{ "label": "Support", "href": "mailto:team@example.com" }]
  },
  "footer": { "socials": { "github": "https://github.com/acme" } }
}
```

Themes: `mint` (classic), `maple` (modern SaaS), `palm` (enterprise/fintech),
`willow` (stripped-back), `linden` (terminal/monospace), `almond` (card-based),
`aspen` (complex navigation), `sequoia` (large content-focused sites), `luma`
(clean minimal).

## Navigation patterns

Pages are file paths without `.mdx`. A page not listed here does not appear in
the sidebar.

**Groups** (the workhorse):

```json
"navigation": {
  "groups": [
    { "group": "Getting started", "icon": "play", "pages": ["quickstart"] },
    {
      "group": "Guides",
      "pages": [
        "guides/setup",
        { "group": "Advanced", "expanded": false, "pages": ["guides/tuning"] }
      ]
    }
  ]
}
```

**Tabs** (top-level split, e.g. Docs / API / Changelog):

```json
"navigation": {
  "tabs": [
    { "tab": "Documentation", "icon": "book-open", "groups": [ ... ] },
    { "tab": "API reference", "icon": "square-terminal", "pages": [ ... ] }
  ]
}
```

**Anchors / dropdowns** — sidebar-level sections; same shape with `"anchor"` /
`"dropdown"` keys. External links use `"href"` instead of `"pages"`. Global
anchors shown on every page:

```json
"navigation": {
  "global": { "anchors": [{ "anchor": "Blog", "href": "https://example.com/blog" }] },
  "groups": [ ... ]
}
```

**Versions / languages** — wrap any of the above:

```json
"navigation": {
  "versions": [
    { "version": "2.0.0", "default": true, "tag": "Latest", "groups": [ ... ] }
  ]
}
```

Useful per-item properties: `root` (group's landing page), `expanded`
(nested-group default state), `tag` (badge), `icon`, `href` (external),
`directory` (auto-generated listing: `"accordion"` | `"card"` | `"none"`).

## Redirects

When moving/renaming pages, keep old URLs working:

```json
"redirects": [
  { "source": "/old/path", "destination": "/new/path" }
]
```

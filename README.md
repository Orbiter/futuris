# Futuris CSS

Futuris is a classless CSS boilerplate with a cyberpunk aesthetic and a small icon set.
It is meant to style plain semantic HTML without adding component classes.

## Purpose
- Provide a single classless stylesheet for headings, text, tables, forms, lists, and layout.
- Offer a neon/cyberpunk visual system with reusable SVG icons.
- Serve as a lightweight demo template (open the HTML files directly in a browser).

## Project shape
- `css/futuris.css`: the classless stylesheet; uses element selectors, IDs, and a few layout utilities.
- `js/futuris.js`: runtime helpers for site navigation and table-of-contents generation.
- `index.html`: general style demo.
- `reference.html`: compact reference view.
- `dashboard.html`: data-style layout demo.
- `icons/`: cyberpunk-style SVG assets (see `icons/README.md` for icon notes).

## JavaScript behavior
`js/futuris.js` currently:
- Builds the header navigation from the `pages` array and sets `aria-current="page"`.
- Marks `#layout` with `has-side-nav` when a sibling nav exists.
- Generates a table of contents from `h2`/`h3` elements into `#toc`.

The author is expected to edit `pages` in `js/futuris.js` to add more pages to the nav.
This file will later grow to include classes for a virtual file system and an LLM client.

## Classless constraint
Keep Futuris classless. Favor semantic HTML and element selectors.
Avoid adding component classes; only minimal layout utilities (like `row-*` and `span-*`)
should exist, and they should remain generic and optional.

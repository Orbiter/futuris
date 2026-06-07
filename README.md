# Futuris CSS

Futuris is a classless CSS boilerplate with a cyberpunk aesthetic and a small icon set.
It is meant to style plain semantic HTML without adding component classes.

## Purpose
- Provide a single classless stylesheet for headings, text, tables, forms, lists, and layout.
- Offer a midnight-blue and acid-yellow cyberpunk theme with reusable SVG icons.
- Serve as a lightweight demo template (open the HTML files directly in a browser).

## Project shape
- `css/futuris.css`: the classless stylesheet; uses element selectors, IDs, and a few layout utilities.
- `index.html`: general style demo.
- `reference.html`: compact reference view.
- `dashboard.html`: data-style layout demo.
- `calendar.html`: monthly calendar demo with navigation.
- `chat.html`: streamed chat with one browser-local conversation per API host. Replies are rendered with a local [markdown-it](https://github.com/markdown-it/markdown-it) bundle ([license](js/vendor/markdown-it-LICENSE.txt)).
- `vfs.html`: file explorer with a syntax-highlighting [Ace editor](https://ace.c9.io/) ([license](js/vendor/ace-1.45.2/LICENSE.txt)) and ZIP folder imports and exports using [zip.js 2.25.0](https://github.com/gildas-lormeau/zip.js/releases/tag/v2.25.0) ([license](js/vendor/zip-LICENSE.txt)). Both libraries are bundled locally.
- `console.html`: [xterm.js](https://xtermjs.org/) terminal with [just-bash 3.6.1](https://github.com/vercel-labs/just-bash/releases/tag/just-bash%403.6.1). The adapter in `js/just-bash-vfs.js` uses the public file operations in `js/vfs.js`.
- `code-studio.html`: tabbed Ace workspace for the same VFS. Open files from the Explorer and save with Ctrl+S or Command+S.
- `virtual_browser.html`: website preview from the VFS. A folder with an `index.html` directly inside it has a Play action in the Explorer.
- `icons/`: cyberpunk-style SVG assets (see `icons/README.md` for icon notes).

The HTML pages use the first eight characters of the stylesheet's SHA-256 digest as the `?v=` cache key for `futuris.css` and `vfs-editor.css`. Update their references when publishing changes to either stylesheet.

## VFS website previews

Serve Futuris over HTTPS or start `python3 -m http.server 8000 --bind 127.0.0.1` in the project folder. Open [the local VFS](http://127.0.0.1:8000/vfs.html) and use Play on a website folder. The service worker serves files under `run/` from the current origin's VFS. To bring files from a different origin or a direct HTML session, use the Explorer's ZIP export and import.

Project scripts run in the Futuris origin.

## Console

Open Console and Explorer on the same browser origin to share files. The Console starts in `/`. Type at the prompt and press Enter to run a command. Try `ls`, `cd`, or `printf 'Hello\n' > hello.txt`. Tab completes VFS paths up to the longest shared prefix. Up and Down recall commands, Shift+Enter inserts a line break, and Ctrl+C interrupts a running command.

The working directory, scalar shell variables, and command recall are kept in the tab. Files and directories persist in the VFS. The VFS supports regular files and directories, and link creation reports `ENOTSUP`. The local just-bash bundle uses its browser entry, including its browser runtime limits. Licenses are in [js/vendor](js/vendor).

`more` and `less` are registered as custom commands that display files or piped input like `cat`.

The inline prompt uses a local bundle of [xterm-readline 2.0.0](https://github.com/strtok/xterm-readline) ([licenses](js/vendor/xterm-readline-LICENSE.txt)). To rebuild it, extract the npm package, apply [the patch](js/vendor/xterm-readline-2.0.0.patch) with `patch -p1`, and install `string-width@4.2.3`. Bundle `lib/readline.js` with esbuild 0.27.0 using `--bundle --platform=browser --format=iife --global-name=XtermReadline --define:window.localStorage=undefined --minify --legal-comments=none` and save it as `js/vendor/xterm-readline-2.0.0.js`.

## Navigation
The pages share `navigation.html`. Its links open in the parent page, and the URL fragment highlights the current entry. Home and Reference link directly to headings in their tables of contents.

## Classless constraint
Keep Futuris classless. Favor semantic HTML and element selectors.
Avoid adding component classes; only minimal layout utilities (like `row-*` and `span-*`)
should exist, and they should remain generic and optional.

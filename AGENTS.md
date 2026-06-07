# Repository instructions

Futuris is a static site built with HTML, CSS, and browser JavaScript. The pages run without a build step.

## HTML and CSS

- Use semantic HTML for content and navigation. Use native links, buttons, and form controls so keyboard navigation
  and accessible names work with the browser's built-in behavior.
- Keep the shared menu in `navigation.html`. Use HTML and CSS for static content and add JavaScript for interactions
  that need it.
- Use classless CSS wherever practical. Style semantic HTML elements directly and reuse the typography, colors,
  and layout rules in `css/futuris.css`. Add a class when it makes a layout or state clearer than a structural selector.
  Keep page-specific styles scoped to their page.

## JavaScript

- Keep the steps of one operation together. Extract a function when callers share behavior or a browser API needs
  a separate callback. Function length alone is a poor reason to split an operation.
- Prefer direct calls, readable loops, and named intermediate values. Use `const` by default and `let` for
  reassignment. Give objects consistent property names and document their shape when callers need clarification.
- Keep state close to the code that owns it. Make the lifetime of event listeners, pending requests, and timers clear.
  Account for overlapping reads and writes when an operation can be retried or interrupted.
- Consider the cost of DOM updates, copying file contents, and storage or network access. Preserve deliberate
  performance choices such as streaming responses and grouping related writes in one transaction.
- Use the public API in `js/vfs.js` for virtual file operations. This keeps storage behavior consistent across
  the Explorer, Code Studio, Console, and preview worker.

## Editing and verification

- Follow nearby naming and formatting conventions. Simplify redundant code in files touched by the task.
  A little duplication is reasonable when sharing would require more configuration or indirection.
- Preserve public APIs, saved data, validation, and error handling. Use comments to explain constraints or decisions
  that would otherwise be hard to infer from the code.
- Verify the changed behavior through the affected page. Test local-file behavior when relevant, and use localhost
  or HTTPS for service worker previews. For layout or control changes, check the affected viewport and input method.

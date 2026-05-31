# Claude Code instructions

## Branch workflow

**Always create a feature branch before making any changes.** Direct pushes to `main` are blocked by branch protection.

At the start of every session:
```
git checkout main
git pull origin main
git checkout -b feature/<short-description>
```

When work is ready:
```
git push origin feature/<short-description>
gh pr create
```

Branch naming examples: `feature/export-settings`, `fix/empty-bullets`, `refactor/renderer`.

## Repository layout

```
browser-extension/   Chrome extension source (the only thing that ships)
  manifest.json
  popup.html
  popup.css
  popup.js
  jszip.min.js
  README.md
  CLAUDE.md          (this file)
```

## Key architecture notes

- All Workflowy data is fetched via the internal API (`/get_tree_data/`, `/get_initialization_data`, `/file-proxy/signed-original/`) using the browser's existing session cookie — no API key or credentials stored in the extension.
- `fetchInTab(tabId, url)` is the single entry point for all authenticated WF requests; it injects a `fetch()` call into the WF tab.
- Signed S3 URLs are pre-fetched in parallel (`prefetchSignedUrls`) before rendering begins, so the WF tab is no longer needed during the download phase.
- `renderNode` is the recursive renderer; rendering options live in a `config` object threaded through the call tree.

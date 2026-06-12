# Workflowy to Obsidian

A Chrome extension that exports the currently active Workflowy node to an Obsidian-ready Markdown file, including downloaded file attachments.

<img width="357" height="223" alt="image" src="https://github.com/user-attachments/assets/4d6d7030-78c5-4074-b068-561de3b04b79" />

## What it does

When you click **Export to ZIP**, the extension:

1. Reads the currently active (zoomed-in) Workflowy node and its entire subtree via Workflowy's internal API — no need to expand nodes first
2. Converts the outline to Markdown — H2 headings, bullets, bold/italic, links, blockquotes, and code blocks are all translated
3. Optionally downloads file attachments found in the outline and packages everything into a ZIP file ready to drop into your Obsidian vault

The exported Markdown file uses Obsidian's `![[attachments/filename]]` embed syntax for attachments, so files display inline once the ZIP is extracted into your vault.

## Requirements and limitations

### Keep the popup open during export

The extension popup must stay open until the export finishes. Clicking anywhere outside the popup (including on the Workflowy tab) will close it and cancel the export. A notice in the popup reminds you of this.

### File attachments require an active Workflowy session

Attachment downloads use your existing Workflowy browser session. You must be logged in to Workflowy in the same Chrome profile.

## Installation

The extension is not on the Chrome Web Store. Load it manually:

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `browser-extension` folder
5. The Workflowy → Obsidian icon will appear in your toolbar

## Usage

1. Open [workflowy.com](https://workflowy.com) in Chrome
2. Navigate to (zoom into) the node you want to export
3. Click the extension icon in the toolbar
4. Check or uncheck **Download attachments** as needed
5. Click **Export to ZIP** and keep the popup open until it finishes

**If attachments are present:** a `.zip` file is downloaded containing the `.md` file and an `attachments/` folder. Extract both into the same location in your Obsidian vault.

**If there are no attachments:** a plain `.md` file is downloaded.

## Markdown conversion reference

| Workflowy                  | Obsidian Markdown                          |
|:---------------------------|:-------------------------------------------|
| Exported root node         | File name only (no heading inside the file)|
| First-level children       | `## H2 heading`                            |
| Deeper children            | `- bullet` (indented per level)            |
| Node note                  | `> blockquote` beneath its heading/bullet  |
| Bold / italic / links      | `**bold**` / `*italic*` / `[text](url)`    |
| Quote-block layout         | `> quoted text`                            |
| Code-block layout          | ` ```fenced code``` `                      |
| File/image attachment      | `![[attachments/filename_id.ext]]`         |

## Permissions

| Permission      | Why it is needed |
|:----------------|:-----------------|
| `tabs`          | Read the active tab's URL to confirm you are on Workflowy and detect the current node |
| `scripting`     | Inject minimal scripts into the Workflowy tab to call Workflowy's internal API using your existing session |
| `storage`       | Remember your **Download attachments** preference between sessions |
| `workflowy.com` | Scope the above permissions to Workflowy only |

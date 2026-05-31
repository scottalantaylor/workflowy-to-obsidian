# Workflowy to Obsidian

A Chrome extension that exports the currently active Workflowy node to an Obsidian-ready Markdown file, including downloaded image attachments.

<img width="356" height="191" alt="image" src="https://github.com/user-attachments/assets/81c0f58e-7c21-430a-b7c8-70e35079dc18" />

## What it does

When you click **Export to ZIP**, the extension:

1. Reads the currently active (zoomed-in) Workflowy node and its entire subtree
2. Converts the outline to Markdown — bullets, headings, bold/italic, links, blockquotes, and code blocks are all translated
3. Optionally downloads image attachments found in the outline and packages everything into a ZIP file ready to drop into your Obsidian vault

The exported Markdown file uses Obsidian's `![[attachments/filename]]` embed syntax for images, so attachments display inline once the ZIP is extracted into your vault.

## Requirements and limitations

### The node must be fully expanded

The extension can only export content that is **visible in the Workflowy outline**. Workflowy uses virtual rendering, so nodes that are collapsed or not yet scrolled into view are not accessible. Before exporting:

- Navigate to (zoom into) the node you want to export — it becomes the root of the exported file
- Expand all child nodes you want included

### Only images are downloaded

The **Download attachments** option retrieves image files embedded in the outline (JPEG, PNG, GIF, WebP, etc.). Other file types attached to Workflowy nodes — PDFs, spreadsheets, email files, and so on — are referenced in the Markdown as `![[attachments/filename]]` placeholders but are **not downloaded**.

## Installation

The extension is not on the Chrome Web Store. Load it manually:

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `browser-extension` folder
5. The Workflowy → Obsidian icon will appear in your toolbar

## Usage

1. Open [workflowy.com](https://workflowy.com) in Chrome
2. Navigate to the node you want to export and make sure it is fully expanded
3. Click the extension icon in the toolbar
4. Check or uncheck **Download attachments** as needed
5. Click **Export to ZIP**

The extension scrolls through the outline to collect fresh image proxy URLs, then renders the Markdown and triggers a download.

**If attachments are present:** a `.zip` file is downloaded containing the `.md` file and an `attachments/` folder. Extract both into the same location in your Obsidian vault.

**If there are no attachments:** a plain `.md` file is downloaded.

## Markdown conversion reference

| Workflowy                  | Obsidian Markdown                       |
|----------------------------|-----------------------------------------|
| Node name                  | `# Heading` (root) or `- bullet`        |
| Node note                  | `> blockquote` beneath the bullet       |
| Bold / italic / links      | `**bold**` / `*italic*` / `[text](url)` |
| Quote-block layout         | `> quoted text`                         |
| Code-block layout          | ` ```fenced code``` `                   |
| Image attachment           | `![[attachments/filename_id.ext]]`      |

## Permissions

| Permission      | Why it is needed |
|-----------------|------------------|
| `tabs`          | Read the active tab's URL to detect the current Workflowy node |
| `scripting`     | Inject scripts into the Workflowy page to read the outline data and download images |
| `storage`       | Remember your **Download attachments** preference between sessions |
| `workflowy.com` | Scope the above permissions to Workflowy only |

// ─────────────────────────────────────────────────────────────────────────────
// UI references
// ─────────────────────────────────────────────────────────────────────────────
const splitStrategyEl    = document.getElementById("split-strategy");
const rootNodeIdEl       = document.getElementById("root-node-id");
const useCurrentBtn      = document.getElementById("use-current");
const skipCompletedEl    = document.getElementById("skip-completed");
const downloadAttachEl   = document.getElementById("download-attachments");
const exportBtn          = document.getElementById("export-button");
const statusBar          = document.getElementById("status-bar");
const logContainer       = document.getElementById("log-container");
const logOutput          = document.getElementById("log-output");

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────
const logLines = [];
function log(level, ...args) {
  const msg = args.join(" ");
  logLines.push(`[${level}] ${msg}`);
  logOutput.textContent = logLines.join("\n");
  logContainer.classList.remove("hidden");
  logContainer.scrollTop = logContainer.scrollHeight;
  console[level === "ERROR" ? "error" : "log"](msg);
}
const Logger = {
  info:  (...a) => log("INFO",  ...a),
  debug: (...a) => log("DEBUG", ...a),
  error: (...a) => log("ERROR", ...a),
  warn:  (...a) => log("WARN",  ...a),
};

// ─────────────────────────────────────────────────────────────────────────────
// Status bar helpers
// ─────────────────────────────────────────────────────────────────────────────
function setStatus(msg, type = "info") {
  statusBar.textContent = msg;
  statusBar.className = "status-bar" + (type === "error" ? " error" : type === "success" ? " success" : "");
  statusBar.classList.remove("hidden");
}

// ─────────────────────────────────────────────────────────────────────────────
// ── UTILS (ported from lib/utils.js) ─────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
}

/** Turn a Workflowy node name into a safe filename */
function safeName(name, fallback = "Untitled") {
  const base = (name || fallback)
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\(https?[^)]*\)/g, "$1")
    .replace(/\(https?[^)]*\)/gi, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/#(\S+)/g, "$1")
    .replace(/🡒/g, " to ")
    .replace(/=&gt;/g, " to ")
    .replace(/&gt;/g, " to ")
    .replace(/=>/g, " to ")
    .replace(/:/g, "-")
    .replace(/[/\\*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return base || fallback;
}

/** Strip Workflowy's inline HTML → Markdown */
function wfHtmlToMd(html) {
  if (!html) return "";
  return html
    .replace(/<b>(.*?)<\/b>/gi, "**$1**")
    .replace(/<i>(.*?)<\/i>/gi, "*$1*")
    .replace(/<a href="(.*?)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

/** Strip all HTML tags and decode entities */
function wfStripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

function posixJoin(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ATTACHMENT DOWNLOADER (ported from lib/downloader.js) ─────────────────────
//    Uses fetch() instead of Node https — returns ArrayBuffer for JSZip
// ─────────────────────────────────────────────────────────────────────────────

/** Map of attachmentUniqueName → ArrayBuffer (populated during export) */
const attachmentBuffers = {};

/** Fetch a Workflowy file-proxy URL from inside the WF tab. */
async function downloadAttachmentViaTab(tabId, url) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (fetchUrl) => {
      function bufToB64(buf) {
        const bytes = new Uint8Array(buf);
        let b64 = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          b64 += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        return btoa(b64);
      }

      // 1. Try fetch (standard, with cookies)
      try {
        const res = await fetch(fetchUrl, { credentials: "include" });
        if (res.ok) return { ok: true, b64: bufToB64(await res.arrayBuffer()) };
      } catch (_) {}

      // 2. img + canvas fallback — browser loads images without CORS checks;
      //    works even when the proxy redirects to a signed S3 URL.
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext("2d").drawImage(img, 0, 0);
          try {
            const dataUrl = canvas.toDataURL("image/png");
            resolve({ ok: true, b64: dataUrl.split(",")[1], forceExt: ".png" });
          } catch (e) {
            resolve({ ok: false, status: "canvas tainted: " + e.message });
          }
        };
        img.onerror = () => resolve({ ok: false, status: "img load failed" });
        // No crossOrigin attribute — lets browser load without triggering CORS
        img.src = fetchUrl;
      });
    },
    args: [url],
  });

  if (!result || !result.ok) {
    throw new Error(result ? result.status : "no result from tab");
  }
  const binary = atob(result.b64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return { buf, forceExt: result.forceExt || null };
}

let _activeTabId = null;

async function downloadAttachment(url) {
  try {
    return await downloadAttachmentViaTab(_activeTabId, url);
  } catch (e) {
    Logger.error(`Download failed: ${e.message} — ${url}`);
    return null;
  }
}

/**
 * Handle an attachment node.
 * @param {object} node  - serialised WF node with file metadata
 * @param {string} label
 * @param {string} nodeId
 * @param {boolean} shouldDownload
 * @returns {string} Markdown embed string
 */
async function handleAttachment(node, label, nodeId, shouldDownload) {
  const meta = node.file;
  if (!meta) return `<!-- missing file metadata on "${label}" -->`;
  Logger.debug(`Attachment: "${label.slice(0,40)}" → ${(meta.url || "no url").slice(0, 80)}`);

  const ext = meta.fileName
    ? "." + meta.fileName.split(".").pop()
    : meta.fileType
    ? "." + meta.fileType.split("/")[1]
    : ".bin";

  const baseName = meta.fileName
    ? safeName(meta.fileName.replace(/\.[^.]+$/, "")) + ext
    : safeName(label || "attachment") + ext;

  const uniqueId = nodeId ? nodeId.substring(0, 8) : shortHash(label || "");
  const uniqueName = baseName.replace(ext, "") + "_" + uniqueId + ext;

  if (!shouldDownload) {
    return `![[attachments/${uniqueName}]]`;
  }

  if (attachmentBuffers[uniqueName]) {
    return `![[attachments/${uniqueName}]]`;
  }

  const url = meta.url;
  if (!url) {
    Logger.warn(`No URL available for attachment "${label}"`);
    return `<!-- attachment unavailable: ${baseName} -->`;
  }

  Logger.info(`↓ Downloading: ${uniqueName}`);
  const result = await downloadAttachment(url);
  if (result) {
    // Canvas fallback always produces PNG; rename if the extension changed
    let finalName = uniqueName;
    if (result.forceExt && !uniqueName.endsWith(result.forceExt)) {
      finalName = uniqueName.replace(/\.[^.]+$/, result.forceExt);
    }
    attachmentBuffers[finalName] = result.buf;
    return `![[attachments/${finalName}]]`;
  }
  return `<!-- download failed: ${baseName} -->`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── RENDERER (ported from lib/renderer.js) ───────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

async function renderNode(list, depth, lines, config) {
  if (config.skipCompleted && list.isCompleted) return;

  const layoutMode = list.source && list.source.layoutMode;
  const name = wfHtmlToMd(list.name);
  const note = wfHtmlToMd(list.note);
  const isImageOnlyNode = list.hasFile && !name.trim();

  if (layoutMode === "quote-block" && depth > 0) {
    const indent = "    ".repeat(depth - 1);
    const rawText = wfStripHtml(list.name);
    for (const line of rawText.split("\n")) {
      lines.push(`${indent}> ${line}`);
    }
    if (note) {
      const noteLines = note.split("\n");
      lines.push(`${indent}> ${noteLines.join(`\n${indent}> `)}`);
    }
  } else if (layoutMode === "code-block" && depth > 0) {
    const indent = "    ".repeat(depth - 1);
    const rawText = wfStripHtml(list.name);
    lines.push(`${indent}\`\`\``);
    for (const line of rawText.split("\n")) {
      lines.push(`${indent}${line}`);
    }
    lines.push(`${indent}\`\`\``);
    return; // don't recurse into children of code blocks
  } else if (depth === 0) {
    if (!isImageOnlyNode) lines.push(`# ${name}`);
    if (note) {
      const noteLines = note.split("\n");
      lines.push(`\n> ${noteLines.join("\n> ")}\n`);
    }
  } else {
    const indent = "    ".repeat(depth - 1);
    const bullet = `${indent}- `;
    if (isImageOnlyNode) {
      lines.push(`${bullet}<!-- image placeholder -->`);
    } else {
      const nameLines = name.split("\n");
      lines.push(`${bullet}${nameLines[0]}`);
      for (let i = 1; i < nameLines.length; i++) {
        lines.push(`${indent}  ${nameLines[i]}`);
      }
      if (note) {
        const noteLines = note.split("\n");
        lines.push(`${indent}    > ${noteLines.join(`\n${indent}    > `)}`);
      }
    }
  }

  if (list.hasFile) {
    const label = name || `node-${shortHash(list.name || "")}`;
    Logger.info(`↓ Queueing attachment: "${label.slice(0, 60)}"`);
    const embed = await handleAttachment(list, label, list.id, config.downloadAttachments);
    if (isImageOnlyNode && depth > 0) {
      lines[lines.length - 1] = `${"    ".repeat(depth - 1)}${embed}`;
    } else if (depth === 0) {
      lines.push(embed);
    } else {
      lines.push(`${"    ".repeat(depth)}${embed}`);
    }
  }

  for (const child of list.items || []) {
    await renderNode(child, depth + 1, lines, config);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── EXPORTERS (ported from lib/exporters.js) ──────────────────────────────────
//    Instead of writing files, everything goes into a JSZip instance.
// ─────────────────────────────────────────────────────────────────────────────

function findNodeById(items, id) {
  const needle = (id || "").replace(/-/g, "").toLowerCase();
  for (const item of items) {
    if ((item.id || "").replace(/-/g, "").toLowerCase() === needle) return item;
    if (item.items && item.items.length) {
      const found = findNodeById(item.items, id);
      if (found) return found;
    }
  }
  return null;
}

/** exportChildrenAsPages — one file per direct child of rootNode */
async function exportChildrenAsPages(rootNode, zip, baseDir, config) {
  Logger.info("Exporting one file per child node...");
  const usedNames = new Map();
  let fileCount = 0;

  for (const childNode of rootNode.items || []) {
    if (config.skipCompleted && childNode.isCompleted) continue;

    const rawName = wfHtmlToMd(childNode.name) || "Untitled";
    let fileName = `${safeName(rawName)}.md`;

    if (usedNames.has(fileName)) {
      const count = usedNames.get(fileName) + 1;
      usedNames.set(fileName, count);
      fileName = `${safeName(rawName)} (${count}).md`;
    } else {
      usedNames.set(fileName, 1);
    }

    Logger.info(`  -> "${rawName.slice(0, 60)}"`);
    const lines = [];
    await renderNode(childNode, 0, lines, config);
    zip.file(posixJoin(baseDir, fileName), lines.join("\n"));
    fileCount++;
  }

  Logger.info(`✓ Exported ${fileCount} files`);
}

/** exportTopLevelFiles — one file per top-level node */
async function exportTopLevelFiles(items, zip, baseDir, config) {
  Logger.info(`Exporting ${items.length} top-level nodes as separate files...`);
  const usedNames = new Map();

  for (const item of items) {
    if (config.skipCompleted && item.isCompleted) continue;

    const rawName = wfHtmlToMd(item.name) || "Untitled";
    let fileName = `${safeName(rawName)}.md`;

    if (usedNames.has(fileName)) {
      const count = usedNames.get(fileName) + 1;
      usedNames.set(fileName, count);
      fileName = `${safeName(rawName)} (${count}).md`;
    } else {
      usedNames.set(fileName, 1);
    }

    Logger.info(`  -> "${rawName.slice(0, 60)}"`);
    const lines = [];
    await renderNode(item, 0, lines, config);
    zip.file(posixJoin(baseDir, fileName), lines.join("\n"));
  }

  Logger.info(`✓ Exported ${usedNames.size} files`);
}

/** exportSingleFile — one big combined markdown file */
async function exportSingleFile(items, zip, baseDir, config) {
  Logger.info("Exporting as single combined file...");
  const lines = [];
  for (const item of items) {
    await renderNode(item, 0, lines, config);
    lines.push("", "---", "");
  }
  zip.file(posixJoin(baseDir, "workflowy-full.md"), lines.join("\n"));
  Logger.info("✓ workflowy-full.md written");
}

/** exportAllAsFiles — every node becomes its own file in a nested folder tree */
async function exportAllAsFiles(items, zip, parentPath, config) {
  for (const item of items) {
    if (config.skipCompleted && item.isCompleted) continue;

    const rawName = wfHtmlToMd(item.name) || "Untitled";
    const folderName = safeName(rawName);
    const thisPath = parentPath ? posixJoin(parentPath, folderName) : folderName;

    Logger.debug(`  -> ${thisPath}/${folderName}.md`);

    const lines = [];
    const name = wfHtmlToMd(item.name);
    const note = wfHtmlToMd(item.note);
    if (name) lines.push(`# ${name}`);
    if (note) lines.push(`\n> ${note}\n`);
    for (const child of item.items || []) {
      lines.push(`- [[${safeName(wfHtmlToMd(child.name) || "Untitled")}]]`);
    }

    zip.file(posixJoin(thisPath, `${folderName}.md`), lines.join("\n"));

    if (item.items && item.items.length) {
      await exportAllAsFiles(item.items, zip, thisPath, config);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── WORKFLOWY DATA EXTRACTION (via chrome.scripting) ──────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injected into the Workflowy page context to serialise the outline tree.
 * We use the WF global that WorkFlowy exposes, falling back to the raw
 * PROJECT_TREE / INIT_DATA if the newer API isn't available.
 */
function extractWorkflowyData(targetNodeId) {
  function serializeNode(node) {
    const data = node.getProjectData ? node.getProjectData() : node;
    const id = (node.getProjectId ? node.getProjectId() : data.id || data.projectid || "").replace(/^root-/, "");

    // name / note
    const name = node.getName ? node.getName() : (data.nm || data.name || "");
    const note = node.getNote ? node.getNote() : (data.no || data.note || "");

    const isCompleted = node.isCompleted ? node.isCompleted() : !!(data.cp);

    // layout / source
    const layoutMode = data.metadata && data.metadata.layoutMode ? data.metadata.layoutMode : undefined;

    // file attachment — metadata lives at node.data.metadata.s3File
    let file = null;
    let hasFile = false;
    const innerMeta = ((node.data || {}).metadata) || {};

    if (innerMeta.s3File) {
      hasFile = true;
      const fi = innerMeta.s3File;

      // WF renders file nodes with <a href="https://workflowy.com/file-proxy/file/FRESH_TOKEN/">
      // in the DOM. This token is authenticated and works; the raw objectFolder is not.
      let domUrl = null;
      const allAnchors = [...document.querySelectorAll("a[href*='file-proxy']")];
      if (allAnchors.length) {
        let best = null;
        if (id) {
          const nodeEl = document.querySelector(`[data-id="${id}"], [data-projectid="${id}"]`);
          if (nodeEl) best = nodeEl.querySelector("a[href*='file-proxy']");
        }
        domUrl = (best || allAnchors[0]).href;
      }
      if (!domUrl) {
        const img = document.querySelector("img[src*='file-proxy'], img[src^='blob:'], img[src^='data:']");
        if (img) domUrl = img.src;
      }

      file = {
        fileName: fi.fileName || null,
        fileType: fi.fileType || null,
        url: domUrl
          || (fi.url || null)
          || (fi.objectFolder ? `https://workflowy.com/file-proxy/file/${fi.objectFolder}/` : null),
      };
    } else if (data.metadata && data.metadata.fileInfo) {
      hasFile = true;
      const fi = data.metadata.fileInfo;
      file = {
        fileName: fi.fileName || fi.originalFileName || null,
        fileType: fi.fileType || fi.contentType || null,
        url: fi.url || fi.downloadUrl || null,
      };
    }

    const children = node.getChildren ? node.getChildren() : (node.ch || node.children || []);
    const childArray = Array.isArray(children) ? children : [];

    return {
      id,
      name,
      note,
      isCompleted,
      hasFile,
      file,
      source: layoutMode ? { layoutMode } : undefined,
      items: childArray.map(serializeNode),
    };
  }

  try {
    // If a specific node ID was requested, try fetching it directly first
    if (targetNodeId && typeof WF !== "undefined" && WF.getItemById) {
      const stripped = targetNodeId.replace(/-/g, "");
      const node = WF.getItemById(targetNodeId) || WF.getItemById(stripped);
      if (node) {
        return { ok: true, items: [serializeNode(node)], directNode: true };
      }
    }

    // Modern WF API — full tree
    if (typeof WF !== "undefined" && WF.rootItem) {
      const root = WF.rootItem();
      const children = root.getChildren ? root.getChildren() : [];
      return { ok: true, items: children.map(serializeNode) };
    }

    // Older / direct project tree
    if (typeof WF !== "undefined" && WF.getItemById) {
      const root = WF.getItemById("root");
      if (root) {
        const children = root.getChildren ? root.getChildren() : [];
        return { ok: true, items: children.map(serializeNode) };
      }
    }

    return { ok: false, error: "WF global not found — make sure you are on workflowy.com and fully loaded." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getWorkflowyItems(tabId, nodeId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: extractWorkflowyData,
    args: [nodeId || null],
  });
  return result || { ok: false, error: "No result from page script" };
}

async function getCurrentNodeId(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const uuidPattern = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi;
      function getMatches(value) {
        if (!value || typeof value !== "string") return [];
        return [...new Set(value.match(uuidPattern) ?? [])];
      }
      function readJson(value) {
        try { return JSON.stringify(value); } catch { return ""; }
      }
      function addCandidates(store, source, values) {
        for (const value of values) { if (value) store.push({ id: value, source }); }
      }
      const candidates = [];
      addCandidates(candidates, "url", getMatches(window.location.href));
      addCandidates(candidates, "history", getMatches(readJson(window.history.state)));
      const canonicalHref = document.querySelector("link[rel='canonical']")?.href ?? "";
      addCandidates(candidates, "canonical", getMatches(canonicalHref));
      const attributeNames = ["data-id", "data-node-id", "data-projectid", "data-item-id", "data-page-id", "id", "href"];
      const scopedElements = [
        ...document.querySelectorAll("[data-id], [data-node-id], [data-projectid], [data-item-id], [data-page-id]"),
        ...document.querySelectorAll("a[href*='workflowy.com']"),
        ...document.querySelectorAll("nav a, [aria-label*='breadcrumb' i] a"),
      ];
      for (const element of scopedElements.slice(0, 200)) {
        for (const attributeName of attributeNames) {
          addCandidates(candidates, "dom:" + attributeName, getMatches(element.getAttribute?.(attributeName) ?? ""));
        }
        addCandidates(candidates, "dom:text", getMatches(element.textContent ?? ""));
      }
      const htmlPreview = document.documentElement?.outerHTML?.slice(0, 250000) ?? "";
      addCandidates(candidates, "html", getMatches(htmlPreview));
      const seen = new Set();
      const orderedCandidates = [];
      for (const candidate of candidates) {
        if (!candidate.id || seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        orderedCandidates.push(candidate);
      }
      return orderedCandidates[0]?.id ?? null;
    },
  });
  return result || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── NODE ID NORMALISATION (from workflowy-to-obsidian.js) ─────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function normalizeRootNodeId(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/(?:workflowy\.com\/(?:#\/)?|workflowy\.com\/s\/[^/]+\/)([a-f0-9-]{36})/i);
  if (urlMatch) return urlMatch[1];
  const uuidMatch = trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  if (uuidMatch) return uuidMatch[0];
  const hashMatch2 = trimmed.match(/[\/#]([a-zA-Z0-9]{4,})\s*$/);
  if (hashMatch2) return hashMatch2[1];
  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── MAIN EXPORT ORCHESTRATION ─────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

async function runExport() {
  logLines.length = 0;
  logOutput.textContent = "";
  Object.keys(attachmentBuffers).forEach(k => delete attachmentBuffers[k]);

  exportBtn.disabled = true;
  setStatus("Starting export…");

  const config = {
    splitStrategy:       splitStrategyEl.value,
    skipCompleted:       skipCompletedEl.checked,
    downloadAttachments: downloadAttachEl.checked,
  };

  const rawRootId = rootNodeIdEl.value.trim();
  const rootNodeId = rawRootId ? normalizeRootNodeId(rawRootId) : null;

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes("workflowy.com")) {
      setStatus("Please open a Workflowy tab first.", "error");
      exportBtn.disabled = false;
      return;
    }

    _activeTabId = tab.id;
    setStatus("Extracting outline from Workflowy…");
    Logger.info("Extracting outline from Workflowy…");

    const result = await getWorkflowyItems(tab.id, rootNodeId);
    if (!result.ok) {
      setStatus(`Could not read outline: ${result.error}`, "error");
      Logger.error(result.error);
      exportBtn.disabled = false;
      return;
    }

    const allItems = result.items;
    Logger.info(`Got ${allItems.length} top-level nodes`);

    const zip = new JSZip();

    if (rootNodeId) {
      Logger.info(`Looking for root node: ${rootNodeId}`);
      let rootNode;
      if (result.directNode) {
        rootNode = allItems[0];
        Logger.info(`Found node directly via WF API`);
      } else {
        rootNode = findNodeById(allItems, rootNodeId);
      }
      if (!rootNode) {
        setStatus(`Root node "${rootNodeId}" not found in outline.`, "error");
        Logger.error(`Node not found: ${rootNodeId}`);
        exportBtn.disabled = false;
        return;
      }

      const rootNodeName = wfHtmlToMd(rootNode.name) || "Untitled";
      Logger.info(`Scoped to: "${rootNodeName}" (${(rootNode.items || []).length} direct children)`);
      setStatus(`Exporting: "${rootNodeName.slice(0, 40)}"…`);

      const baseDir = safeName(rootNodeName);
      await exportChildrenAsPages(rootNode, zip, baseDir, config);
    } else if (config.splitStrategy === "single") {
      setStatus("Exporting single file…");
      await exportSingleFile(allItems, zip, "", config);
    } else if (config.splitStrategy === "all") {
      setStatus("Exporting all nodes…");
      await exportAllAsFiles(allItems, zip, "", config);
    } else if (config.splitStrategy === "children") {
      // children strategy without a root node — treat whole outline as root
      setStatus("Exporting top-level nodes as children…");
      const fakeRoot = { items: allItems };
      await exportChildrenAsPages(fakeRoot, zip, "", config);
    } else {
      setStatus("Exporting top-level nodes…");
      await exportTopLevelFiles(allItems, zip, "", config);
    }

    // Add any downloaded attachments into the ZIP
    const attachKeys = Object.keys(attachmentBuffers);
    if (attachKeys.length > 0) {
      Logger.info(`Adding ${attachKeys.length} attachment(s) to ZIP…`);
      for (const name of attachKeys) {
        zip.file(`attachments/${name}`, attachmentBuffers[name]);
      }
    }

    setStatus("Generating ZIP…");
    Logger.info("Generating ZIP…");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });

    // Trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `workflowy-obsidian-${ts}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    setStatus(`✓ Export complete! ${attachKeys.length > 0 ? `(${attachKeys.length} attachment${attachKeys.length > 1 ? "s" : ""} included)` : ""}`, "success");
    Logger.info("Export complete.");
  } catch (e) {
    Logger.error("Unexpected error: " + e.message);
    setStatus(`Error: ${e.message}`, "error");
  } finally {
    exportBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── INIT ──────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  // Restore saved settings
  const saved = await chrome.storage.local.get(["splitStrategy", "skipCompleted", "downloadAttachments", "rootNodeId"]);
  if (saved.splitStrategy)       splitStrategyEl.value       = saved.splitStrategy;
  if (saved.skipCompleted != null)      skipCompletedEl.checked      = saved.skipCompleted;
  if (saved.downloadAttachments != null) downloadAttachEl.checked    = saved.downloadAttachments;
  if (saved.rootNodeId)          rootNodeIdEl.value           = saved.rootNodeId;

  // Persist settings on change
  function saveSettings() {
    chrome.storage.local.set({
      splitStrategy:       splitStrategyEl.value,
      skipCompleted:       skipCompletedEl.checked,
      downloadAttachments: downloadAttachEl.checked,
      rootNodeId:          rootNodeIdEl.value,
    });
  }
  splitStrategyEl.addEventListener("change", saveSettings);
  skipCompletedEl.addEventListener("change", saveSettings);
  downloadAttachEl.addEventListener("change", saveSettings);
  rootNodeIdEl.addEventListener("input", saveSettings);

  // Check if we're on a Workflowy tab and enable the button
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes("workflowy.com")) {
    exportBtn.disabled = false;
    setStatus("Ready. Configure options and click Export.", "info");
  } else {
    setStatus("Open a Workflowy tab, then reopen this popup.", "error");
    exportBtn.disabled = true;
    useCurrentBtn.disabled = true;
  }

  // "Use current page node" button
  useCurrentBtn.addEventListener("click", async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab) return;
      const nodeId = await getCurrentNodeId(activeTab.id);
      if (nodeId) {
        rootNodeIdEl.value = nodeId;
        saveSettings();
        setStatus(`Node ID loaded: ${nodeId}`, "success");
      } else {
        setStatus("No node ID found in current URL — are you zoomed into a node?", "error");
      }
    } catch (e) {
      setStatus("Could not read node ID: " + e.message, "error");
    }
  });

  exportBtn.addEventListener("click", runExport);
}

init().catch((e) => {
  setStatus("Init error: " + e.message, "error");
  console.error(e);
});

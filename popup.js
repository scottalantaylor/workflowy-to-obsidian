// ─────────────────────────────────────────────────────────────────────────────
// UI references
// ─────────────────────────────────────────────────────────────────────────────
const downloadAttachEl = document.getElementById("download-attachments");
const exportBtn        = document.getElementById("export-button");
const statusBar        = document.getElementById("status-bar");
const logContainer     = document.getElementById("log-container");
const logOutput        = document.getElementById("log-output");

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
  if (level === "ERROR") console.error(msg); else console.log(msg);
}
const Logger = {
  info:  (...a) => log("INFO",  ...a),
  debug: (...a) => log("DEBUG", ...a),
  error: (...a) => log("ERROR", ...a),
  warn:  (...a) => log("WARN",  ...a),
};

// ─────────────────────────────────────────────────────────────────────────────
// Status bar
// ─────────────────────────────────────────────────────────────────────────────
function setStatus(msg, type = "info") {
  statusBar.textContent = msg;
  statusBar.className = "status-bar" + (type === "error" ? " error" : type === "success" ? " success" : "");
  statusBar.classList.remove("hidden");
}

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────

function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
}

/** Turn a Workflowy node name into a safe filename. */
function safeName(name, fallback = "Untitled") {
  const base = (name || fallback)
    .replace(/<[^>]+>/g, "")            // strip HTML tags
    .replace(/&lt;/g, "<")             // decode entities — &amp; last to avoid double-decode
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\[([^\]]+)\]\(https?[^)]*\)/g, "$1")
    .replace(/\(https?[^)]*\)/gi, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/#(\S+)/g, "$1")
    .replace(/🡒/g, " to ")
    .replace(/=>/g, " to ")            // entities decoded above, so this covers all cases
    .replace(/:/g, "-")
    .replace(/[/\\*?"<>|#^[\]]/g, "")  // also strips any < or > left from entity decode
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return base || fallback;
}

/** Convert Workflowy inline HTML to Markdown. */
function wfHtmlToMd(html) {
  if (!html) return "";
  return html
    .replace(/<b>(.*?)<\/b>/gi, "**$1**")
    .replace(/<i>(.*?)<\/i>/gi, "*$1*")
    .replace(/<a href="(.*?)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")             // decode named entities — &amp; last to avoid double-decode
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Strip all HTML tags and decode entities (used for code/quote blocks). */
function wfStripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")             // decode named entities — &amp; last to avoid double-decode
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Returns true only if the tab's hostname is exactly workflowy.com or a subdomain. */
function isWorkflowyTab(tab) {
  if (!tab || !tab.url) return false;
  try {
    const { hostname } = new URL(tab.url);
    return hostname === "workflowy.com" || hostname.endsWith(".workflowy.com");
  } catch {
    return false;
  }
}

/** Depth-first search for a node by ID (dash-insensitive). */
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

// ─────────────────────────────────────────────────────────────────────────────
// Workflowy API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run an authenticated fetch inside the WF tab (which holds the session cookie).
 * Returns the parsed JSON response body.
 */
async function fetchInTab(tabId, url) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (fetchUrl) => {
      try {
        const res = await fetch(fetchUrl, { credentials: "include" });
        if (!res.ok) return { error: `HTTP ${res.status} ${res.statusText}` };
        return { data: await res.json() };
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [url],
  });
  if (!result) throw new Error(`No result from tab for: ${url}`);
  if (result.error) throw new Error(result.error);
  return result.data;
}

/** Fetch the WF user ID from the initialization data endpoint. */
async function fetchWfUserId(tabId) {
  const data = await fetchInTab(
    tabId,
    "https://workflowy.com/get_initialization_data?client_version=21&client_version_v2=28&no_root_children=1"
  );
  return data.projectTreeData.mainProjectTreeInfo.ownerId;
}

/** Fetch the full flat node list from WF. */
async function fetchWfTreeData(tabId) {
  return fetchInTab(tabId, "https://workflowy.com/get_tree_data/");
}

/**
 * Fetch a signed S3 URL for the original file on a given node.
 * The returned URL is a short-lived pre-signed S3 URL requiring no session cookie.
 */
async function getSignedFileUrl(tabId, userId, nodeId) {
  const data = await fetchInTab(
    tabId,
    `https://workflowy.com/file-proxy/signed-original/${encodeURIComponent(userId)}/${encodeURIComponent(nodeId)}/?attempt=1`
  );
  if (!data.url) throw new Error("No URL in signed-original response");
  return data.url;
}

/**
 * Build a nested tree from the flat array returned by /get_tree_data/.
 * Each raw item has: id, nm (name), no (note), prnt (parent id), pr (priority),
 * cp (completed timestamp), metadata { layoutMode?, s3File? }.
 */
function buildTree(rawItems) {
  const byId = new Map();

  for (const item of rawItems) {
    const s3 = item.metadata && item.metadata.s3File;
    byId.set(item.id, {
      id: item.id,
      name: item.nm || "",
      note: item.no || "",
      isCompleted: !!(item.cp),
      hasFile: !!s3,
      file: s3 ? { fileName: s3.fileName || null, fileType: s3.fileType || null } : null,
      source: (item.metadata && item.metadata.layoutMode)
        ? { layoutMode: item.metadata.layoutMode }
        : undefined,
      items: [],
    });
  }

  // Sort by priority so children are inserted in display order
  const sorted = rawItems.slice().sort((a, b) => a.pr - b.pr);
  const roots = [];

  for (const item of sorted) {
    const node = byId.get(item.id);
    const parentId = item.prnt;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId).items.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** Collect the IDs of every node that has a file attachment (depth-first). */
function collectFileNodeIds(items, result = []) {
  for (const item of items) {
    if (item.hasFile) result.push(item.id);
    collectFileNodeIds(item.items || [], result);
  }
  return result;
}

/**
 * Pre-fetch signed S3 URLs for all file nodes in parallel.
 * Returns { nodeId → signedUrl } — nodes that fail get a null entry.
 */
async function prefetchSignedUrls(tabId, userId, nodeIds) {
  const pairs = await Promise.all(
    nodeIds.map(async (nodeId) => {
      try {
        const url = await getSignedFileUrl(tabId, userId, nodeId);
        return [nodeId, url];
      } catch (e) {
        Logger.warn(`Could not pre-fetch signed URL for ${nodeId}: ${e.message}`);
        return [nodeId, null];
      }
    })
  );
  const map = Object.create(null);
  for (const [k, v] of pairs) map[k] = v;
  return map;
}

/** Fetch and build the full WF tree, returning { ok, items, userId }. */
async function getWorkflowyItems(tabId, nodeId) {
  Logger.info("Fetching WF data via API…");

  const [treeData, userId] = await Promise.all([
    fetchWfTreeData(tabId),
    fetchWfUserId(tabId),
  ]);

  Logger.debug(`Got ${treeData.items.length} nodes, userId=${userId}`);

  const roots = buildTree(treeData.items);

  if (nodeId) {
    const target = findNodeById(roots, nodeId);
    if (!target) return { ok: false, error: `Node ${nodeId} not found in outline` };
    return { ok: true, items: [target], userId };
  }

  return { ok: true, items: roots, userId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Current node detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injected into the WF tab to find the UUID of the currently zoomed-in node.
 * Searches URL, history state, canonical link, DOM attributes, and page HTML
 * in that order of priority.
 */
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
// Attachment handler
// ─────────────────────────────────────────────────────────────────────────────

/** Map of uniqueName → ArrayBuffer, populated during export. */
const attachmentBuffers = {};

/**
 * Resolve and download a file attachment, returning an Obsidian embed string.
 * config must contain { downloadAttachments, signedUrls }.
 */
async function handleAttachment(node, label, nodeId, config) {
  const meta = node.file;
  if (!meta) return `<!-- missing file metadata on "${label}" -->`;
  Logger.debug(`Attachment: "${label.slice(0, 40)}" node=${nodeId}`);

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

  if (!config.downloadAttachments) {
    return `![[attachments/${uniqueName}]]`;
  }

  if (attachmentBuffers[uniqueName]) {
    return `![[attachments/${uniqueName}]]`;
  }

  // Signed URLs are pre-fetched before rendering so the WF tab is no longer needed here
  const signedUrl = config.signedUrls[nodeId];
  if (!signedUrl) {
    Logger.error(`No signed URL available for "${label}" — skipping`);
    return `<!-- attachment unavailable: ${baseName} -->`;
  }

  // Signed S3 URLs are public (no session cookie needed) — fetch directly
  Logger.info(`↓ Downloading: ${uniqueName}`);
  try {
    const res = await fetch(signedUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    attachmentBuffers[uniqueName] = buf;
    return `![[attachments/${uniqueName}]]`;
  } catch (e) {
    Logger.error(`Download failed: ${e.message} — ${uniqueName}`);
    return `<!-- download failed: ${baseName} -->`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────────

async function renderNode(list, depth, lines, config) {
  const layoutMode = list.source && list.source.layoutMode;
  const name = wfHtmlToMd(list.name);
  const note = wfHtmlToMd(list.note);
  const isImageOnly = list.hasFile && !name.trim();

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
    lines.push("");
    if (note) {
      const noteLines = note.split("\n");
      lines.push(`> ${noteLines.join("\n> ")}\n`);
    }
  } else if (depth === 1) {
    if (isImageOnly) {
      lines.push(""); // placeholder replaced by embed below
    } else {
      lines.push("");
      lines.push(`## ${name}`);
      lines.push("");
      if (note) {
        const noteLines = note.split("\n");
        lines.push(`> ${noteLines.join("\n> ")}`);
        lines.push("");
      }
    }
  } else {
    // depth >= 2: bullet list, indented relative to the H2 level
    const indent = "    ".repeat(depth - 2);
    const bullet = `${indent}- `;
    if (isImageOnly) {
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
    Logger.info(`Attachment: "${label.slice(0, 60)}"`);
    const embed = await handleAttachment(list, label, list.id, config);
    if (depth === 0) {
      lines.push(embed);
    } else {
      const embedIndent = "    ".repeat(Math.max(0, depth - 2));
      if (isImageOnly) {
        lines[lines.length - 1] = `${embedIndent}${embed}`;
      } else {
        lines.push(`${embedIndent}${embed}`);
      }
    }
  }

  for (const child of list.items || []) {
    await renderNode(child, depth + 1, lines, config);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export orchestration
// ─────────────────────────────────────────────────────────────────────────────

async function runExport() {
  logLines.length = 0;
  logOutput.textContent = "";
  Object.keys(attachmentBuffers).forEach(k => delete attachmentBuffers[k]);

  exportBtn.disabled = true;
  setStatus("Starting export…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !isWorkflowyTab(tab)) {
      setStatus("Please open a Workflowy tab first.", "error");
      return;
    }

    const rootNodeId = await getCurrentNodeId(tab.id);

    setStatus("Fetching outline from Workflowy API…");
    Logger.info("Fetching outline from Workflowy API…");

    const result = await getWorkflowyItems(tab.id, rootNodeId);
    if (!result.ok) {
      setStatus(`Could not read outline: ${result.error}`, "error");
      Logger.error(result.error);
      return;
    }

    const fileNodeIds = collectFileNodeIds(result.items);
    if (fileNodeIds.length > 0) {
      setStatus(`Fetching ${fileNodeIds.length} file URL(s)…`);
      Logger.info(`Pre-fetching signed URLs for ${fileNodeIds.length} attachment(s)…`);
    }
    const signedUrls = fileNodeIds.length > 0
      ? await prefetchSignedUrls(tab.id, result.userId, fileNodeIds)
      : {};

    const config = {
      downloadAttachments: downloadAttachEl.checked,
      signedUrls,
    };

    let nodesToRender;
    let mdFileName;

    if (rootNodeId) {
      const rootNode = result.items[0];
      const rootNodeName = wfHtmlToMd(rootNode.name) || "Untitled";
      Logger.info(`Exporting: "${rootNodeName}" (${(rootNode.items || []).length} direct children)`);
      setStatus(`Exporting: "${rootNodeName.slice(0, 40)}"…`);
      nodesToRender = [rootNode];
      mdFileName = `${safeName(rootNodeName)}.md`;
    } else {
      setStatus("Exporting outline…");
      nodesToRender = result.items;
      mdFileName = `workflowy-${new Date().toISOString().slice(0, 10)}.md`;
    }

    const lines = [];
    for (const item of nodesToRender) {
      await renderNode(item, 0, lines, config);
    }
    const mdContent = lines
      .filter(l => !/^##\s*$/.test(l))      // remove blank H2s
      .filter(l => !/^\s*-\s*$/.test(l))    // remove empty bullets
      .join("\n");

    const attachKeys = Object.keys(attachmentBuffers);
    let blob;
    let downloadName;

    if (attachKeys.length > 0) {
      Logger.info(`Adding ${attachKeys.length} attachment(s) to ZIP…`);
      const zip = new JSZip();
      zip.file(mdFileName, mdContent);
      for (const name of attachKeys) {
        zip.file(`attachments/${name}`, attachmentBuffers[name]);
      }
      setStatus("Generating ZIP…");
      blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      downloadName = mdFileName.replace(/\.md$/, ".zip");
    } else {
      blob = new Blob([mdContent], { type: "text/markdown" });
      downloadName = mdFileName;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    const attachSummary = attachKeys.length > 0
      ? ` (${attachKeys.length} attachment${attachKeys.length > 1 ? "s" : ""} included)`
      : "";
    setStatus(`✓ Export complete!${attachSummary}`, "success");
    Logger.info("Export complete.");
  } catch (e) {
    Logger.error("Unexpected error: " + e.message);
    setStatus(`Error: ${e.message}`, "error");
  } finally {
    exportBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  const saved = await chrome.storage.local.get(["downloadAttachments"]);
  if (saved.downloadAttachments != null) downloadAttachEl.checked = saved.downloadAttachments;

  downloadAttachEl.addEventListener("change", () => {
    chrome.storage.local.set({ downloadAttachments: downloadAttachEl.checked });
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && isWorkflowyTab(tab)) {
    exportBtn.disabled = false;
    setStatus("Ready. Click Export to export the current node.", "info");
  } else {
    setStatus("Open a Workflowy tab, then reopen this popup.", "error");
    exportBtn.disabled = true;
  }

  exportBtn.addEventListener("click", runExport);
}

init().catch((e) => {
  setStatus("Init error: " + e.message, "error");
  console.error(e);
});

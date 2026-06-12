/* ============================================
   Insight Hub — App Logic
   ============================================ */

const STORAGE_KEY = "insight-hub:issues";
const EMPTY_LIBRARY_RESET_KEY = "insight-hub:empty-library-reset-2026-06-10";
const FILE_STORE_RESET_KEY = "insight-hub:file-store-reset-2026-06-10";
const SERVER_TRUTH_RESET_KEY = "insight-hub:server-truth-reset-2026-06-11";
const DB_NAME = "insight-hub";
const STORE_NAME = "files";
const DB_VERSION = 1;
const DIRECT_SERVER_UPLOAD_LIMIT = 20 * 1024 * 1024;

const state = {
  issues: loadIssues(),
  selectedIssueId: null,
  insightType: "weekly",
  file: null,
  objectUrl: null,
  searchQuery: "",
  filterType: "",
  uploadDialogOpen: false,
  statusPollTimer: null,

};

const els = {
  currentList: document.querySelector("#current-list"),
  historyList: document.querySelector("#history-list"),
  viewerType: document.querySelector("#viewer-type"),
  viewerTitle: document.querySelector("#viewer-title"),
  viewerSummary: document.querySelector("#viewer-summary"),
  viewerMeta: document.querySelector("#viewer-meta"),
  viewerContent: document.querySelector("#viewer-content"),
  dropzone: document.querySelector("#dropzone"),
  fileInput: document.querySelector("#file-input"),
  selectedFile: document.querySelector("#selected-file"),
  uploadStatus: document.querySelector("#upload-status"),
  issueDate: document.querySelector("#issue-date"),
  markLatest: document.querySelector("#mark-latest"),
  searchInput: document.querySelector("#search-input"),
  filterButtons: document.querySelectorAll("[data-filter-type]"),
  openUpload: document.querySelector("#open-upload"),
  closeUpload: document.querySelector("[data-close-upload]"),
  uploadDialog: document.querySelector("#upload-dialog"),
  sidebarStatus: document.querySelector("#sidebar-status"),

  sidebar: document.querySelector("#sidebar"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarOverlay: document.querySelector("#sidebar-overlay"),
};

initialize();

/* ============================================
   Init & Events
   ============================================ */

function initialize() {
  clearStoredFilesOnce();
  els.issueDate.value = formatLocalDate(new Date());
  state.selectedIssueId = latestIssue()?.id || state.issues[0]?.id || null;
  bindEvents();
  render();
  hydrateIssuesFromServer();
}

function bindEvents() {
  // Upload type tabs
  document.querySelectorAll("[data-insight-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.insightType = button.dataset.insightType;
      document.querySelectorAll("[data-insight-type]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });

  // Dropzone: click to select file
  els.fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;
    if (file) handleUpload(file);
  });

  // Dropzone: drag & drop
  els.dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragover");
  });
  els.dropzone.addEventListener("dragleave", () => {
    els.dropzone.classList.remove("dragover");
  });
  els.dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
    const file = e.dataTransfer.files?.[0] || null;
    if (file) handleUpload(file);
  });

  // Search & filters
  els.searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderSidebar();
  });
  els.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.filterType = button.dataset.filterType || "";
      els.filterButtons.forEach((item) => item.classList.toggle("active", item === button));
      renderSidebar();
    });
  });

  // Upload dialog
  els.openUpload.addEventListener("click", () => {
    els.uploadDialog.showModal?.();
    state.uploadDialogOpen = true;
  });
  els.closeUpload.addEventListener("click", closeUploadDialog);
  els.uploadDialog.addEventListener("click", (event) => {
    if (event.target === els.uploadDialog) closeUploadDialog();
  });
  els.uploadDialog.addEventListener("close", () => {
    state.uploadDialogOpen = false;
  });

  // Sync initial filter active state
  els.filterButtons.forEach((button) => {
    button.classList.toggle("active", (button.dataset.filterType || "") === state.filterType);
  });

  // Mobile sidebar
  els.sidebarToggle.addEventListener("click", () => {
    els.sidebar.classList.add("open");
    els.sidebarOverlay.classList.add("active");
  });
  els.sidebarOverlay.addEventListener("click", closeSidebar);
}

function closeUploadDialog() {
  els.uploadDialog.close?.();
  state.uploadDialogOpen = false;
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarOverlay.classList.remove("active");
}

/* ============================================
   Persistence
   ============================================ */

function loadIssues() {
  if (localStorage.getItem(SERVER_TRUTH_RESET_KEY) !== "done") {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(SERVER_TRUTH_RESET_KEY, "done");
    return [];
  }

  if (localStorage.getItem(EMPTY_LIBRARY_RESET_KEY) !== "done") {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(EMPTY_LIBRARY_RESET_KEY, "done");
    return [];
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    return sortIssues(JSON.parse(raw));
  } catch {
    return [];
  }
}

function clearStoredFilesOnce() {
  if (localStorage.getItem(FILE_STORE_RESET_KEY) === "done") return;
  if (typeof indexedDB?.deleteDatabase !== "function") {
    localStorage.setItem(FILE_STORE_RESET_KEY, "done");
    return;
  }

  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => localStorage.setItem(FILE_STORE_RESET_KEY, "done");
  request.onerror = () => localStorage.setItem(FILE_STORE_RESET_KEY, "done");
  request.onblocked = () => localStorage.setItem(FILE_STORE_RESET_KEY, "done");
}

function saveIssues(issues) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sortIssues(issues)));
}

async function hydrateIssuesFromServer() {
  if (typeof fetch !== "function") return;
  await refreshIssuesFromServer();
}

async function refreshIssuesFromServer() {
  if (typeof fetch !== "function") return;
  try {
    const response = await fetch("/api/issues");
    if (!response.ok) return;
    const payload = await response.json();
    if (!Array.isArray(payload.issues)) return;
    const previousSelection = state.selectedIssueId;
    state.issues = sortIssues(payload.issues);
    saveIssues(state.issues);
    state.selectedIssueId = state.issues.some((issue) => issue.id === previousSelection)
      ? previousSelection
      : latestIssue()?.id || state.issues[0]?.id || null;
    render();
    syncIssuePolling();
  } catch {
    // Local cache remains usable when the server is temporarily unavailable.
  }
}

async function refreshIssueFromServer(issueId) {
  if (typeof fetch !== "function" || !issueId) return null;
  try {
    const response = await fetch(`/api/issue?issueId=${encodeURIComponent(issueId)}`);
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload.issue) return null;
    upsertIssue(payload.issue);
    return payload.issue;
  } catch {
    return null;
  }
}

function syncIssuePolling() {
  const hasProcessingIssue = state.issues.some((issue) => ["processing", "queued"].includes(issue.status) || ["queued", "converting", "rendering"].includes(issue.conversionStatus));
  if (hasProcessingIssue && !state.statusPollTimer) {
    state.statusPollTimer = setInterval(refreshIssuesFromServer, 2000);
  }
  if (!hasProcessingIssue && state.statusPollTimer) {
    clearInterval(state.statusPollTimer);
    state.statusPollTimer = null;
  }
}

function upsertIssue(issue) {
  const existingIndex = state.issues.findIndex((item) => item.id === issue.id);
  if (existingIndex >= 0) {
    state.issues[existingIndex] = issue;
  } else {
    state.issues.push(issue);
  }
  state.issues = sortIssues(state.issues);
  saveIssues(state.issues);
}

function markLatestIssue(issueId) {
  state.issues = state.issues.map((issue) => ({
    ...issue,
    isLatest: issue.id === issueId,
  }));
  saveIssues(state.issues);
}

function sortIssues(issues) {
  return [...issues].sort((a, b) => {
    if (a.issueDate === b.issueDate) return b.createdAt.localeCompare(a.createdAt);
    return b.issueDate.localeCompare(a.issueDate);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "issueId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function saveIssueFile(issueId, file) {
  return withStore("readwrite", (store) => store.put({ issueId, file }));
}

function getIssueFile(issueId) {
  return withStore("readonly", (store) => store.get(issueId)).then((result) => result?.file || null);
}

function deleteIssueFile(issueId) {
  return withStore("readwrite", (store) => store.delete(issueId));
}

/* ============================================
   Queries
   ============================================ */

function latestIssue() {
  return state.issues.find((issue) => issue.isLatest) || state.issues[0] || null;
}

function selectedIssue() {
  return state.issues.find((issue) => issue.id === state.selectedIssueId) || latestIssue();
}

function getFilteredIssues() {
  let result = state.issues;

  // Search
  if (state.searchQuery) {
    const q = state.searchQuery;
    result = result.filter((issue) => {
      const fields = [
        issue.title,
        issue.summary,
        issue.category,
        ...(issue.tags || []),
        issue.fileName,
      ];
      return fields.some((field) => String(field || "").toLowerCase().includes(q));
    });
  }

  // Type filter
  if (state.filterType) {
    result = result.filter((issue) => issue.insightType === state.filterType);
  }

  return result;
}

function generateIssueTitle(issueDate, insightType) {
  if (!issueDate) return insightType === "weekly" ? "Weekly Insights" : "Monthly Insights";
  if (insightType === "monthly") return `${issueDate.slice(0, 7)} Monthly Insights`;
  return `${issueDate} Weekly Insights`;
}

/* ============================================
   Render
   ============================================ */

function render() {
  renderSidebar();
  renderViewer();
}



function renderSidebar() {
  const filtered = getFilteredIssues();
  const current = filtered.find((issue) => issue.isLatest) || filtered[0] || null;
  const history = filtered.filter((issue) => issue.id !== current?.id);

  els.currentList.innerHTML = current ? renderNavItem(current) : `<p class="empty-nav">暂无当前文件</p>`;
  els.historyList.innerHTML = history.length
    ? renderHistoryGroups(history)
    : `<p class="empty-nav">暂无历史文件</p>`;

  document.querySelectorAll("[data-issue-id]").forEach((item) => {
    item.addEventListener("click", () => {
      state.selectedIssueId = item.dataset.issueId;
      closeSidebar();
      renderSidebar();
      renderViewer();
    });
  });
  document.querySelectorAll("[data-delete-issue-id]").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteIssue(item.dataset.deleteIssueId);
    });
  });
}

function renderHistoryGroups(issues) {
  const groups = issues.reduce((result, issue) => {
    const monthKey = issue.issueDate?.slice(0, 7) || "未归档日期";
    if (!result.has(monthKey)) result.set(monthKey, []);
    result.get(monthKey).push(issue);
    return result;
  }, new Map());

  return [...groups.entries()]
    .map(([monthKey, groupIssues]) => `
      <section class="history-month">
        <p class="history-month-label">${escapeHtml(formatMonthLabel(monthKey))}</p>
        <div class="history-month-list">
          ${groupIssues.map(renderNavItem).join("")}
        </div>
      </section>
    `)
    .join("");
}

function renderNavItem(issue) {
  const selected = selectedIssue()?.id === issue.id ? "active" : "";
  const status = getIssuePreviewStatus(issue);
  return `
    <div class="nav-item ${selected}">
      <button class="nav-open" type="button" data-issue-id="${issue.id}">
        <strong>${escapeHtml(getIssueDisplayTitle(issue))}</strong>
        <small>${escapeHtml(getIssueDisplayMeta(issue))}</small>
        <span class="nav-status ${status.className}">${escapeHtml(status.label)}</span>
      </button>
      <button class="nav-delete" type="button" data-delete-issue-id="${issue.id}" aria-label="删除 ${escapeHtml(getIssueDisplayTitle(issue))}">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2 3.5h10M5.5 1.5h3M5 5.5v5M9 5.5v5M3.5 3.5l.5 8.5a1 1 0 0 0 1 .95h4a1 1 0 0 0 1-.95l.5-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  `;
}

async function renderViewer() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }

  const issue = selectedIssue();
  if (!issue) {
    els.viewerType.textContent = "Insight Hub";
    els.viewerTitle.textContent = "Insight Hub";
    els.viewerSummary.textContent = "选择左侧文件查看内容。";
    els.viewerMeta.innerHTML = "";
    els.viewerContent.innerHTML = `<div class="empty-viewer">暂无内容</div>`;
    return;
  }

  // Header
  els.viewerType.textContent = issue.insightType === "weekly" ? "Weekly Insight" : "Monthly Insight";
  els.viewerTitle.textContent = getIssueDisplayTitle(issue);
  els.viewerSummary.textContent = renderViewerSummary(issue);

  // Content
  const file = await getIssueFile(issue.id);
  let fileUrl = issue.originalUrl || "";
  if (!fileUrl && file) {
    fileUrl = URL.createObjectURL(file);
    state.objectUrl = fileUrl;
  }
  els.viewerMeta.innerHTML = renderViewerMeta(issue, fileUrl);
  els.viewerContent.innerHTML = renderPreview(issue, file, fileUrl);
  bindPreviewActions();
}

function renderViewerMeta(issue, downloadUrl) {
  const fileExt = getFileExtension(issue);
  const canFullscreen = Boolean((Array.isArray(issue.pageUrls) && issue.pageUrls.length) || issue.previewUrl || fileExt === "PDF");
  const fullscreenAction = canFullscreen
    ? `
      <button class="meta-action" type="button" data-preview-fullscreen aria-label="全屏预览">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M5 1H1v4M9 1h4v4M5 13H1V9M13 9v4H9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        全屏
      </button>
    `
    : "";
  const downloadAction = downloadUrl
    ? `
      <a class="meta-download" href="${downloadUrl}" download="${escapeHtml(issue.fileName)}" aria-label="下载原文件">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 1v8m0 0l-3-3m3 3l3-3M1 10v2.5a1 1 0 001 1h10a1 1 0 001-1V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        下载
      </a>
    `
    : "";

  return `
    ${fullscreenAction}
    ${downloadAction}
  `;
}

function renderViewerSummary(issue) {
  return getIssueDisplayMeta(issue);
}

function getConversionProgress(issue) {
  const progress = issue.conversionProgress || {};
  const percent = Number.isFinite(Number(progress.percent))
    ? Math.max(0, Math.min(100, Math.round(Number(progress.percent))))
    : getFallbackConversionPercent(issue);
  const totalPages = Number(progress.totalPages || 0);
  const processedPages = Number(progress.processedPages || 0);
  const labelMap = {
    queued: "等待处理",
    converting: "转换 PPT",
    rendering: "生成页面预览",
    ready: "发布完成",
  };
  const label = labelMap[progress.phase] || labelMap[issue.conversionStatus] || "生成预览";
  const detail = totalPages
    ? `已完成 ${Math.min(processedPages, totalPages)} / ${totalPages} 页`
    : getIssueProcessingTitle(issue);
  const hint = percent >= 100
    ? "即将刷新预览"
    : "完成后会自动切换为在线预览";

  return {
    percent,
    label,
    detail,
    hint,
  };
}

function getFallbackConversionPercent(issue) {
  if (issue.conversionStatus === "queued") return 5;
  if (issue.conversionStatus === "converting") return 20;
  if (issue.conversionStatus === "rendering") return 55;
  if (issue.conversionStatus === "ready") return 100;
  return issue.status === "processing" ? 10 : 0;
}

function getFileExtension(issue) {
  return issue.fileName?.split(".").pop()?.toUpperCase() || "FILE";
}

function getIssueDisplayTitle(issue) {
  const fileName = issue.fileName || issue.title || "未命名文件";
  return fileName.replace(/\.[^/.]+$/, "");
}

function getIssueDisplayMeta(issue) {
  const type = issue.insightType === "monthly" ? "Monthly Insight" : "Weekly Insight";
  return issue.issueDate ? `${issue.issueDate} · ${type}` : type;
}

function bindPreviewActions() {
  const fullscreenButton = document.querySelector("[data-preview-fullscreen]");
  const slideReader = document.querySelector("[data-slide-reader]");
  fullscreenButton?.addEventListener("click", () => {
    const previewShell = document.querySelector(".preview-shell");
    if (!previewShell) return;

    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }

    previewShell.requestFullscreen?.();
  });
  bindSlideReader(slideReader);
}

function renderPreview(issue, file, fileUrl = "") {
  const isPdf = issue.fileType === "application/pdf" || issue.fileName.toLowerCase().endsWith(".pdf");
  const hasPdfPreview = Boolean(issue.previewUrl);
  const isSample = !file;
  const fileSizeText = formatFileSize(issue.fileSize);
  const pageUrls = Array.isArray(issue.pageUrls) ? issue.pageUrls : [];

  if (issue.status === "processing" || ["queued", "converting", "rendering"].includes(issue.conversionStatus)) {
    const progress = getConversionProgress(issue);
    return `
      <div class="preview-shell">
        <div class="preview-stage">
          <div class="fallback-card processing-card">
            <div class="file-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <path d="M8 14h8M8 18h5"/>
              </svg>
            </div>
            <h3>${escapeHtml(getIssueProcessingTitle(issue))}</h3>
            <p>${escapeHtml(issue.conversionMessage || "系统正在后台生成在线预览，完成后会自动更新。")}</p>
            <div class="conversion-progress" aria-label="预览生成进度">
              <div class="conversion-progress-head">
                <span>${escapeHtml(progress.label)}</span>
                <strong>${progress.percent}%</strong>
              </div>
              <div class="conversion-progress-bar" aria-hidden="true">
                <span style="width: ${progress.percent}%"></span>
              </div>
              <div class="conversion-progress-meta">
                <span>${escapeHtml(progress.detail)}</span>
                <span>${escapeHtml(progress.hint)}</span>
              </div>
            </div>
            <div class="file-meta">
              <span>${escapeHtml(issue.fileName)}</span>
              <span>${fileSizeText}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (issue.status === "failed") {
    return `
      <div class="preview-shell">
        <div class="preview-stage">
          <div class="fallback-card">
            <div class="file-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <path d="M12 9v4M12 17h.01"/>
              </svg>
            </div>
            <h3>预览生成失败</h3>
            <p>${escapeHtml(issue.conversionMessage || "当前文件暂时无法生成在线预览，请下载原文件查看。")}</p>
            <div class="file-meta">
              <span>${escapeHtml(issue.fileName)}</span>
              <span>${fileSizeText}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (pageUrls.length) {
    return `
      <div class="preview-shell">
        <div class="slide-reader" data-slide-reader data-current-slide="0" data-pages='${escapeHtml(JSON.stringify(pageUrls))}' tabindex="0">
          <div class="slide-edge-zone" aria-hidden="true"></div>
          <button class="thumbnail-toggle" type="button" data-toggle-thumbnails aria-label="隐藏缩略图">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M5 2L2 7l3 5M12 2H8M12 7H8M12 12H8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <aside class="slide-thumbnails" aria-label="页面缩略图">
            ${pageUrls
              .map((pageUrl, index) => `
                <button class="slide-thumb ${index === 0 ? "active" : ""}" type="button" data-slide-thumb="${index}" aria-label="跳转到第 ${index + 1} 页">
                  <img src="${escapeHtml(pageUrl)}" alt="" loading="${index < 4 ? "eager" : "lazy"}" />
                  <span>${index + 1}</span>
                </button>
              `)
              .join("")}
          </aside>
          <div class="slide-stack">
            ${pageUrls
              .map((pageUrl, index) => `
                <figure class="slide-page" data-slide-page="${index}">
                  <img class="slide-image" data-slide-image src="${escapeHtml(pageUrl)}" alt="${escapeHtml(issue.title)} 第 ${index + 1} 页" loading="${index === 0 ? "eager" : "lazy"}" />
                </figure>
              `)
              .join("")}
          </div>
        </div>
      </div>
    `;
  }

  if (hasPdfPreview || (file && isPdf)) {
    const url = issue.previewUrl || fileUrl;
    return `
      <div class="preview-shell">
        <div class="preview-stage">
          <embed class="pdf-embed" src="${url}" type="application/pdf" />
        </div>
      </div>
    `;
  }

  // PPT or no real file — show honest fallback
  let fallbackBody = "";
  if (file || issue.originalUrl) {
    // Real file but not PDF (e.g. PPT)
    const conversionMessage = issue.conversionMessage || "当前版本暂不支持 PPT 在线预览，请下载原文件查看。";
    fallbackBody = `
      <p>${escapeHtml(conversionMessage)}</p>
      <div class="file-meta">
        <span>${escapeHtml(issue.fileName)}</span>
        <span>${fileSizeText}</span>
      </div>
    `;
  } else {
    // Sample/demo file with no blob
    fallbackBody = `
      <p>这是演示数据，尚未上传真实文件。</p>
      <div class="file-meta">
        <span>${escapeHtml(issue.fileName)}</span>
        <span>${fileSizeText}</span>
      </div>
      <span class="btn" style="opacity:0.5;cursor:default;">下载原文件</span>
    `;
  }

  return `
    <div class="preview-shell">
      ${isSample ? `
        <div class="sample-notice">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 1.5l5.5 10H1.5L7 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M7 5.5v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            <circle cx="7" cy="10" r="0.5" fill="currentColor"/>
          </svg>
          演示文件 · 尚未上传真实文件
        </div>
      ` : ""}
      <div class="preview-stage">
        <div class="fallback-card">
          <div class="file-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <h3>${escapeHtml(issue.title)}</h3>
          ${fallbackBody}
        </div>
      </div>
    </div>
  `;
}

function bindSlideReader(slideReader) {
  if (!slideReader || typeof slideReader.querySelector !== "function") return;
  const pageUrls = JSON.parse(slideReader.dataset.pages || "[]");
  const thumbnailToggle = slideReader.querySelector("[data-toggle-thumbnails]");
  const thumbnailRail = slideReader.querySelector(".slide-thumbnails");
  const pages = [...slideReader.querySelectorAll("[data-slide-page]")];
  const thumbs = [...slideReader.querySelectorAll("[data-slide-thumb]")];

  const updateSlide = (index) => {
    if (!pageUrls.length) return;
    const nextIndex = Math.min(Math.max(index, 0), pageUrls.length - 1);
    slideReader.dataset.currentSlide = String(nextIndex);
    thumbs.forEach((thumb, index) => {
      thumb.classList.toggle("active", index === nextIndex);
      if (index === nextIndex && thumbnailRail) {
        thumbnailRail.scrollTo({
          top: Math.max(thumb.offsetTop - thumbnailRail.clientHeight / 2 + thumb.clientHeight / 2, 0),
          behavior: "smooth",
        });
      }
    });
  };
  const scrollToSlide = (index) => {
    const nextIndex = Math.min(Math.max(index, 0), pageUrls.length - 1);
    const targetPage = pages[nextIndex];
    if (!targetPage) return;
    const readerRect = slideReader.getBoundingClientRect();
    const targetRect = targetPage.getBoundingClientRect();
    const targetTop = slideReader.scrollTop + targetRect.top - readerRect.top - 16;
    slideReader.scrollTo({
      top: Math.max(targetTop, 0),
      behavior: "smooth",
    });
    updateSlide(nextIndex);
    slideReader.focus?.({ preventScroll: true });
  };
  const syncCurrentFromScroll = () => {
    if (!pages.length) return;
    const readerRect = slideReader.getBoundingClientRect();
    const readerCenter = readerRect.top + readerRect.height / 2;
    let closestIndex = 0;
    let closestDistance = Infinity;
    pages.forEach((page, index) => {
      const rect = page.getBoundingClientRect();
      const pageCenter = rect.top + rect.height / 2;
      const distance = Math.abs(pageCenter - readerCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    updateSlide(closestIndex);
  };
  const currentIndex = () => Number(slideReader.dataset.currentSlide || 0);
  thumbs.forEach((thumb) => {
    thumb.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToSlide(Number(thumb.dataset.slideThumb || 0));
    });
  });
  thumbnailToggle?.addEventListener("click", () => {
    const collapsed = slideReader.classList.toggle("thumbnails-collapsed");
    thumbnailToggle.setAttribute("aria-label", collapsed ? "显示缩略图" : "隐藏缩略图");
  });
  slideReader.addEventListener("scroll", () => {
    window.requestAnimationFrame?.(syncCurrentFromScroll) || syncCurrentFromScroll();
  }, { passive: true });
  slideReader.addEventListener("keydown", (event) => {
    const nextKeys = ["ArrowRight", "ArrowDown", "PageDown", " "];
    const prevKeys = ["ArrowLeft", "ArrowUp", "PageUp"];
    if (nextKeys.includes(event.key)) {
      event.preventDefault();
      scrollToSlide(currentIndex() + 1);
    }
    if (prevKeys.includes(event.key)) {
      event.preventDefault();
      scrollToSlide(currentIndex() - 1);
    }
  });
  slideReader.focus?.({ preventScroll: true });
  updateSlide(0);
}

/* ============================================
   Upload
   ============================================ */

function isAcceptedFile(file) {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx") || lowerName.endsWith(".pdf");
}

async function handleUpload(file) {
  setSelectedFile(file, "已选择，准备上传...");

  if (!isAcceptedFile(file)) {
    setUploadStatus("仅支持 PPT、PPTX 或 PDF 文件。");
    setSelectedFile(file, "格式不支持");
    return;
  }

  const issueDate = els.issueDate.value;

  if (!issueDate) {
    setUploadStatus("请先选择所属日期。");
    setSelectedFile(file, "等待选择所属日期");
    els.issueDate.focus?.();
    return;
  }

  const now = new Date().toISOString();
  const issue = {
    id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: generateIssueTitle(issueDate, state.insightType),
    insightType: state.insightType,
    issueDate,
    category: "",
    summary: "",
    tags: [],
    fileName: file.name,
    fileType: file.type || inferFileType(file.name),
    fileSize: file.size || 0,
    originalUrl: "",
    previewUrl: "",
    conversionStatus: "pending",
    conversionMessage: "",
    status: "published",
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    isLatest: Boolean(els.markLatest.checked),
  };

  const uploadStartedAt = Date.now();
  const updateProgress = (progress) => {
    const status = formatUploadProgress(progress, uploadStartedAt);
    setSelectedFile(file, status.label, {
      progress: status.progress,
      indeterminate: status.indeterminate,
    });
    setUploadStatus(status.message);
  };

  updateProgress({ phase: "uploading", loaded: 0, total: file.size || 0, percent: 0 });

  try {
    const serverUpload = await uploadFileForPreview(issue.id, file, updateProgress);
    const uploadedIssue = serverUpload.issue || { ...issue, ...serverUpload };
    upsertIssue(uploadedIssue);
    state.selectedIssueId = uploadedIssue.id;
    els.fileInput.value = "";
    updateProgress({ phase: uploadedIssue.conversionStatus === "queued" ? "queued" : "rendering" });
    setSelectedFile(file, "已上传，正在后台生成预览", { progress: 100 });
    setUploadStatus("已上传，正在后台生成预览。");
    closeUploadDialog();
    render();
    syncIssuePolling();
    if (serverUpload.issue) waitForIssuePublish(uploadedIssue.id);
  } catch (error) {
    console.error(error);
    setSelectedFile(file, "上传失败");
    setUploadStatus(error.message || "文件保存失败，请重试或检查网络连接。");
  }
}

async function deleteIssue(issueId) {
  const issue = state.issues.find((item) => item.id === issueId);
  if (!issue) return;

  const confirmed = window.confirm(`确定删除「${getIssueDisplayTitle(issue)}」吗？此操作会移除该文件和预览资产。`);
  if (!confirmed) return;

  try {
    await deleteIssueFile(issueId).catch(() => {});
    await deleteIssueAssets(issueId).catch(() => {});

    const wasSelected = selectedIssue()?.id === issueId;
    const wasLatest = issue.isLatest;
    state.issues = state.issues.filter((item) => item.id !== issueId);

    if (wasLatest && state.issues.length) {
      state.issues = state.issues.map((item, index) => ({
        ...item,
        isLatest: index === 0,
      }));
    }

    state.selectedIssueId = wasSelected
      ? latestIssue()?.id || state.issues[0]?.id || null
      : state.selectedIssueId;

    saveIssues(state.issues);
    setUploadStatus("已删除文件。");
    render();
  } catch (error) {
    console.error(error);
    setUploadStatus("删除失败，请重试。");
  }
}

async function deleteIssueAssets(issueId) {
  if (typeof fetch !== "function") return;
  await fetch(`/api/issue?issueId=${encodeURIComponent(issueId)}`, { method: "DELETE" });
}

async function waitForIssuePublish(issueId) {
  const maxAttempts = 180;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await delay(2000);
    const issue = await refreshIssueFromServer(issueId);
    if (!issue) continue;
    render();
    syncIssuePolling();
    if (issue.status === "published") {
      setUploadStatus("发布完成，可在线预览。");
      return;
    }
    if (issue.status === "failed") {
      setUploadStatus(issue.conversionMessage || "生成预览失败，请下载原文件查看。");
      return;
    }
  }
}

async function uploadFileForPreview(issueId, file, onProgress) {
  if (typeof fetch !== "function") {
    throw new Error("无法连接服务器，请刷新页面后重试。");
  }

  try {
    return await uploadFileToCloudStorage(issueId, file, onProgress);
  } catch (error) {
    if (!shouldFallbackToServerUpload(error, file)) throw error;
    return uploadFileWithProgress(issueId, file, onProgress);
  }
}

function buildUploadMetadata(issueId, file) {
  return {
    issueId,
    fileName: file.name,
    insightType: state.insightType,
    issueDate: els.issueDate.value,
    fileType: file.type || inferFileType(file.name),
    fileSize: String(file.size || 0),
    isLatest: String(Boolean(els.markLatest.checked)),
  };
}

async function uploadFileToCloudStorage(issueId, file, onProgress) {
  const metadata = buildUploadMetadata(issueId, file);
  const initiateResponse = await fetch("/api/upload/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  const initiatePayload = await initiateResponse.json().catch(() => ({}));
  if (!initiateResponse.ok) {
    const error = new Error(initiatePayload.error || "无法创建云端上传会话。");
    error.status = initiateResponse.status;
    throw error;
  }

  await uploadToResumableUrl(initiatePayload.uploadUrl, file, onProgress);
  onProgress?.({ phase: "queued", loaded: file.size || 0, total: file.size || 0, percent: 100 });

  const completeResponse = await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  const completePayload = await completeResponse.json().catch(() => ({}));
  if (!completeResponse.ok) {
    throw new Error(completePayload.error || "文件已上传，但登记发布失败，请重试。");
  }
  return completePayload;
}

function shouldFallbackToServerUpload(error, file) {
  if ((file.size || 0) > DIRECT_SERVER_UPLOAD_LIMIT) return false;
  return error?.status === 400 || error?.status === 404;
}

function uploadToResumableUrl(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        onProgress?.({ phase: "uploading", loaded: 0, total: file.size || 0, indeterminate: true });
        return;
      }
      onProgress?.({
        phase: "uploading",
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      });
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`云端上传失败（${request.status || "网络异常"}），请重试。`));
    });
    request.addEventListener("error", () => reject(new Error("云端上传网络异常，请重试。")));
    request.addEventListener("timeout", () => reject(new Error("云端上传超时，请重试。")));
    request.timeout = 900000;
    request.send(file);
  });
}

async function uploadFileWithFetch(issueId, file) {
  const params = new URLSearchParams(buildUploadMetadata(issueId, file));
  const response = await fetch(`/api/upload?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.conversionMessage || payload.error || "上传到服务器失败，请重试。");
  }
  return payload;
}

function uploadFileWithProgress(issueId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams(buildUploadMetadata(issueId, file));
    const request = new XMLHttpRequest();
    let processingTimer = null;

    const clearProcessingTimer = () => {
      if (!processingTimer) return;
      clearTimeout(processingTimer);
      processingTimer = null;
    };

    request.open("POST", `/api/upload?${params.toString()}`);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        onProgress?.({ phase: "uploading", loaded: 0, total: file.size || 0, indeterminate: true });
        return;
      }
      onProgress?.({
        phase: "uploading",
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      });
    });
    request.upload.addEventListener("load", () => {
      onProgress?.({ phase: "queued", loaded: file.size || 0, total: file.size || 0, percent: 100 });
    });
    request.addEventListener("load", () => {
      clearProcessingTimer();
      const payload = parseJsonResponse(request.responseText);
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload.conversionMessage || payload.error || "上传到服务器失败，请重试。"));
        return;
      }
      resolve(payload);
    });
    request.addEventListener("error", () => {
      clearProcessingTimer();
      reject(new Error("上传网络异常，请重试。"));
    });
    request.addEventListener("timeout", () => {
      clearProcessingTimer();
      reject(new Error("上传超时，请重试。"));
    });
    request.timeout = 360000;
    request.send(file);
  });
}

function parseJsonResponse(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function inferFileType(fileName) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lowerName.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  return "application/octet-stream";
}

function setUploadStatus(message) {
  els.uploadStatus.textContent = message;
  els.uploadStatus.hidden = !message;
  if (els.sidebarStatus) {
    els.sidebarStatus.textContent = message;
    els.sidebarStatus.hidden = !message;
  }
}

function setSelectedFile(file, status, options = {}) {
  if (!els.selectedFile) return;
  if (!file) {
    els.selectedFile.hidden = true;
    els.selectedFile.innerHTML = "";
    return;
  }

  els.selectedFile.hidden = false;
  const progressValue = Number.isFinite(options.progress)
    ? Math.max(0, Math.min(100, Math.round(options.progress)))
    : null;
  const progressMarkup = progressValue !== null || options.indeterminate
    ? `
      <span class="selected-file-progress ${options.indeterminate ? "indeterminate" : ""}" aria-hidden="true">
        <span style="width: ${progressValue ?? 44}%"></span>
      </span>
    `
    : "";

  els.selectedFile.innerHTML = `
    <span class="selected-file-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V6L9 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M9 1.5V6h4.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      </svg>
    </span>
    <span class="selected-file-text">
      <strong>${escapeHtml(file.name)}</strong>
      <small>${escapeHtml(formatFileSize(file.size || 0))} · ${escapeHtml(status)}</small>
    </span>
    ${progressMarkup}
  `;
}

function formatUploadProgress(progress, startedAt) {
  if (progress.phase === "queued") {
    return {
      label: "上传完成，等待后台处理...",
      message: "上传完成，等待后台处理...",
      progress: 100,
    };
  }

  if (progress.phase === "converting") {
    return {
      label: "上传完成，正在转换 PPT...",
      message: "上传完成，正在转换 PPT...",
      progress: 100,
    };
  }

  if (progress.phase === "rendering") {
    return {
      label: "正在生成高清预览...",
      message: "正在生成高清预览...",
      progress: 100,
    };
  }

  if (progress.phase === "published") {
    return {
      label: "发布完成",
      message: "发布完成",
      progress: 100,
    };
  }

  const percent = Number.isFinite(progress.percent)
    ? Math.max(0, Math.min(100, Math.round(progress.percent)))
    : null;
  const remaining = formatRemainingUploadTime(progress.loaded, progress.total, startedAt);
  const suffix = remaining ? ` · 预计还需 ${remaining}` : "";

  return {
    label: percent === null ? "正在上传..." : `正在上传 ${percent}%${suffix}`,
    message: percent === null ? "正在上传文件..." : `正在上传文件 ${percent}%${suffix}`,
    progress: percent,
    indeterminate: percent === null,
  };
}

function formatRemainingUploadTime(loaded, total, startedAt) {
  if (!loaded || !total || loaded >= total) return "";
  const elapsedSeconds = Math.max(0.5, (Date.now() - startedAt) / 1000);
  const bytesPerSecond = loaded / elapsedSeconds;
  if (!bytesPerSecond) return "";
  const remainingSeconds = Math.ceil((total - loaded) / bytesPerSecond);
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return "";
  if (remainingSeconds < 60) return `${remainingSeconds} 秒`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

/* ============================================
   Utils
   ============================================ */

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthLabel(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;
  const [year, month] = monthKey.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function getIssuePreviewStatus(issue) {
  if (issue.status === "processing" || issue.conversionStatus === "queued") {
    return { label: "处理中", className: "pending" };
  }
  if (issue.conversionStatus === "converting") {
    return { label: "转换中", className: "pending" };
  }
  if (issue.conversionStatus === "rendering") {
    return { label: "生成预览中", className: "pending" };
  }
  if (Array.isArray(issue.pageUrls) && issue.pageUrls.length) {
    return { label: "可在线预览", className: "ready" };
  }
  if (issue.previewUrl || issue.fileType === "application/pdf" || issue.fileName?.toLowerCase().endsWith(".pdf")) {
    return { label: "可预览", className: "ready" };
  }
  if (issue.conversionStatus === "pending") {
    return { label: "转换中", className: "pending" };
  }
  if (issue.conversionStatus === "failed") {
    return { label: "需下载查看", className: "failed" };
  }
  return { label: "已归档", className: "" };
}

function getIssueProcessingTitle(issue) {
  if (issue.conversionStatus === "converting") return "正在转换 PPT";
  if (issue.conversionStatus === "rendering") return "正在生成高清预览";
  return "等待后台处理";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

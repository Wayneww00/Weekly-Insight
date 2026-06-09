/* ============================================
   Insight Hub — App Logic
   ============================================ */

const STORAGE_KEY = "insight-hub:issues";
const DB_NAME = "insight-hub";
const STORE_NAME = "files";
const DB_VERSION = 1;

const sampleIssues = [
  {
    id: "sample-2026-06-01",
    title: "2026-06-01 Weekly Insights",
    insightType: "weekly",
    issueDate: "2026-06-01",
    category: "市场机会雷达",
    summary: "汇总宏观、行业、地区活动与未来事件，统一判断风险暴露和市场机会窗口。",
    tags: ["Crypto 行业", "市场动态", "中影响"],
    fileName: "2026-06-01-weekly-insights.pdf",
    fileType: "application/pdf",
    fileSize: 12800000,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    isLatest: true,
  },
  {
    id: "sample-2026-05",
    title: "2026-05 Monthly Insights",
    insightType: "monthly",
    issueDate: "2026-05-01",
    category: "竞品资讯",
    summary: "五月月度洞察复盘消费科技新品、渠道变化和主要厂商的 AI 功能竞争。",
    tags: ["Consumer", "AI Devices", "Monthly"],
    fileName: "2026-05-monthly-insights.pptx",
    fileType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    fileSize: 23500000,
    createdAt: "2026-05-31T09:00:00.000Z",
    updatedAt: "2026-05-31T09:00:00.000Z",
    isLatest: false,
  },
  {
    id: "sample-2026-05-18",
    title: "2026-05-18 Weekly Insights",
    insightType: "weekly",
    issueDate: "2026-05-18",
    category: "AI 新闻",
    summary: "本期覆盖 AI 产品更新、模型部署、企业应用落地和算力基础设施趋势。",
    tags: ["AI 新闻", "产品更新", "高影响"],
    fileName: "2026-05-18-weekly-insights.pdf",
    fileType: "application/pdf",
    fileSize: 9400000,
    createdAt: "2026-05-18T09:00:00.000Z",
    updatedAt: "2026-05-18T09:00:00.000Z",
    isLatest: false,
  },
];

const state = {
  issues: loadIssues(),
  selectedIssueId: null,
  insightType: "weekly",
  file: null,
  objectUrl: null,
  searchQuery: "",
  filterType: "",

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
  uploadStatus: document.querySelector("#upload-status"),
  issueDate: document.querySelector("#issue-date"),
  markLatest: document.querySelector("#mark-latest"),
  searchInput: document.querySelector("#search-input"),
  filterType: document.querySelector("#filter-type"),

  sidebar: document.querySelector("#sidebar"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarOverlay: document.querySelector("#sidebar-overlay"),
};

initialize();

/* ============================================
   Init & Events
   ============================================ */

function initialize() {
  els.issueDate.value = formatLocalDate(new Date());
  state.selectedIssueId = latestIssue()?.id || state.issues[0]?.id || null;
  bindEvents();
  render();
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
  els.filterType.addEventListener("change", (e) => {
    state.filterType = e.target.value;
    renderSidebar();
  });


  // Mobile sidebar
  els.sidebarToggle.addEventListener("click", () => {
    els.sidebar.classList.add("open");
    els.sidebarOverlay.classList.add("active");
  });
  els.sidebarOverlay.addEventListener("click", closeSidebar);
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarOverlay.classList.remove("active");
}

/* ============================================
   Persistence
   ============================================ */

function loadIssues() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    saveIssues(sampleIssues);
    return sampleIssues;
  }
  try {
    return sortIssues(JSON.parse(raw));
  } catch {
    saveIssues(sampleIssues);
    return sampleIssues;
  }
}

function saveIssues(issues) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sortIssues(issues)));
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
    ? history.map(renderNavItem).join("")
    : `<p class="empty-nav">暂无历史文件</p>`;

  document.querySelectorAll("[data-issue-id]").forEach((item) => {
    item.addEventListener("click", () => {
      state.selectedIssueId = item.dataset.issueId;
      closeSidebar();
      renderSidebar();
      renderViewer();
    });
  });
}

function renderNavItem(issue) {
  const selected = selectedIssue()?.id === issue.id ? "active" : "";
  const type = issue.insightType === "weekly" ? "Weekly" : "Monthly";
  return `
    <button class="nav-item ${selected}" type="button" data-issue-id="${issue.id}">
      <span class="nav-icon">${issue.isLatest ? "●" : "□"}</span>
      <span>
        <strong>${escapeHtml(issue.title)}</strong>
        <small>${type}${issue.category ? ` · ${escapeHtml(issue.category)}` : ""}</small>
      </span>
    </button>
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
  els.viewerTitle.textContent = issue.title;
  els.viewerSummary.textContent = issue.summary || issue.fileName;

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
  const fileSizeText = formatFileSize(issue.fileSize);
  const fileExt = issue.fileName.split(".").pop()?.toUpperCase() || "FILE";
  const previewLabel = issue.previewUrl && fileExt !== "PDF" ? `${fileExt}→PDF` : fileExt;
  const canFullscreen = Boolean(issue.previewUrl || fileExt === "PDF");
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
    <span class="meta-tag">${escapeHtml(previewLabel)}</span>
    <span class="meta-tag">${fileSizeText}</span>
    ${fullscreenAction}
    ${downloadAction}
  `;
}

function bindPreviewActions() {
  const fullscreenButton = document.querySelector("[data-preview-fullscreen]");
  const exitFullscreenButton = document.querySelector("[data-exit-fullscreen]");
  fullscreenButton?.addEventListener("click", () => {
    const previewShell = document.querySelector(".preview-shell");
    if (!previewShell) return;

    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }

    previewShell.requestFullscreen?.();
  });
  exitFullscreenButton?.addEventListener("click", () => {
    document.exitFullscreen?.();
  });
}

function renderPreview(issue, file, fileUrl = "") {
  const isPdf = issue.fileType === "application/pdf" || issue.fileName.toLowerCase().endsWith(".pdf");
  const hasPdfPreview = Boolean(issue.previewUrl);
  const isSample = !file;
  const fileSizeText = formatFileSize(issue.fileSize);

  if (hasPdfPreview || (file && isPdf)) {
    const url = issue.previewUrl || fileUrl;
    return `
      <div class="preview-shell">
        <button class="fullscreen-exit" type="button" data-exit-fullscreen aria-label="退出全屏">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M5 1v4H1M9 1v4h4M5 13V9H1M13 9H9v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          退出全屏
        </button>
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

/* ============================================
   Upload
   ============================================ */

function isAcceptedFile(file) {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx") || lowerName.endsWith(".pdf");
}

async function handleUpload(file) {
  if (!isAcceptedFile(file)) {
    setUploadStatus("仅支持 PPT、PPTX 或 PDF 文件。");
    return;
  }

  const issueDate = els.issueDate.value;

  if (!issueDate) {
    setUploadStatus("请先选择所属日期。");
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

  setUploadStatus("正在保存文件...");

  try {
    const serverUpload = await uploadFileForPreview(issue.id, file);
    Object.assign(issue, serverUpload);
    await saveIssueFile(issue.id, file);
    if (issue.isLatest) markLatestIssue("");
    upsertIssue(issue);
    state.selectedIssueId = issue.id;
    if (issue.isLatest) markLatestIssue(issue.id);
    els.fileInput.value = "";
    setUploadStatus("上传成功，已保存到历史归档。");
    render();
  } catch (error) {
    console.error(error);
    setUploadStatus("文件保存失败，请重试或检查浏览器存储空间。");
  }
}

async function uploadFileForPreview(issueId, file) {
  if (typeof fetch !== "function") {
    return {
      conversionStatus: "local",
      conversionMessage: "当前环境未连接本地预览服务，已保留浏览器本地预览/下载。",
    };
  }

  const params = new URLSearchParams({
    issueId,
    fileName: file.name,
  });
  const response = await fetch(`/api/upload?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      conversionStatus: "failed",
      conversionMessage: payload.conversionMessage || payload.error || "上传到本地预览服务失败。",
    };
  }
  return payload;
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
}

/* ============================================
   Utils
   ============================================ */

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

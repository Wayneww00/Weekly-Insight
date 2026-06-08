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
  state.selectedIssueId = latestIssue()?.id || state.issues[0]?.id || null;
  bindEvents();
  render();
}

function bindEvents() {
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
    result = result.filter(
      (issue) =>
        issue.title.toLowerCase().includes(q) ||
        issue.category.toLowerCase().includes(q) ||
        (issue.summary && issue.summary.toLowerCase().includes(q)) ||
        issue.tags.some((tag) => tag.toLowerCase().includes(q))
    );
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
        <small>${type}</small>
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
  els.viewerTitle.textContent = issue.category;
  els.viewerSummary.textContent = issue.summary || issue.title;

  const fileSizeText = formatFileSize(issue.fileSize);
  const fileExt = issue.fileName.split(".").pop()?.toUpperCase() || "FILE";
  els.viewerMeta.innerHTML = `
    <span class="meta-tag">${escapeHtml(fileExt)}</span>
    <span class="meta-tag">${fileSizeText}</span>
  `;

  // Content
  const file = await getIssueFile(issue.id);
  els.viewerContent.innerHTML = renderPreview(issue, file);

  // Wire download
  const downloadBtn = document.querySelector("#download-btn");
  if (downloadBtn && file) {
    const url = URL.createObjectURL(file);
    state.objectUrl = url;
    downloadBtn.href = url;
    downloadBtn.download = issue.fileName;
  }
}

function renderPreview(issue, file) {
  const isPdf = issue.fileType === "application/pdf" || issue.fileName.toLowerCase().endsWith(".pdf");
  const isSample = !file;
  const fileSizeText = formatFileSize(issue.fileSize);
  const fileExt = issue.fileName.split(".").pop()?.toUpperCase() || "FILE";

  if (file && isPdf) {
    // Real PDF with blob — embed it
    const url = URL.createObjectURL(file);
    state.objectUrl = url;
    return `
      <div class="preview-shell">
        <div class="preview-toolbar">
          <div class="preview-toolbar-info">
            <span class="file-type-badge">PDF</span>
            <strong>${escapeHtml(issue.fileName)}</strong>
            <span>${fileSizeText}</span>
          </div>
          <div class="preview-actions">
            <a id="download-btn" class="btn btn-primary" href="${url}" download="${escapeHtml(issue.fileName)}">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M7 1v8m0 0l-3-3m3 3l3-3M1 10v2.5a1 1 0 001 1h10a1 1 0 001-1V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              下载原文件
            </a>
          </div>
        </div>
        <div class="preview-stage">
          <embed class="pdf-embed" src="${url}" type="application/pdf" />
        </div>
      </div>
    `;
  }

  // PPT or no real file — show honest fallback
  let fallbackBody = "";
  if (file) {
    // Real file but not PDF (e.g. PPT)
    const url = URL.createObjectURL(file);
    state.objectUrl = url;
    fallbackBody = `
      <p>当前版本暂不支持 PPT 在线预览，请下载原文件查看。</p>
      <div class="file-meta">
        <span>${escapeHtml(issue.fileName)}</span>
        <span>${fileSizeText}</span>
      </div>
      <a id="download-btn" class="btn btn-primary" href="${url}" download="${escapeHtml(issue.fileName)}">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 1v8m0 0l-3-3m3 3l3-3M1 10v2.5a1 1 0 001 1h10a1 1 0 001-1V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        下载原文件
      </a>
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

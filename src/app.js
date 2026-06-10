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
  uploadDialogOpen: false,

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
    <button class="nav-item ${selected}" type="button" data-issue-id="${issue.id}">
      <span>
        <strong>${escapeHtml(getIssueDisplayTitle(issue))}</strong>
        <small>${escapeHtml(getIssueDisplayMeta(issue))}</small>
        <span class="nav-status ${status.className}">${escapeHtml(status.label)}</span>
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
    ${fullscreenAction}
    ${downloadAction}
  `;
}

function renderViewerSummary(issue) {
  return getIssueDisplayMeta(issue);
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

  setUploadStatus("正在上传并生成在线预览...");

  try {
    const serverUpload = await uploadFileForPreview(issue.id, file);
    Object.assign(issue, serverUpload);
    await saveIssueFile(issue.id, file);
    if (issue.isLatest) markLatestIssue("");
    upsertIssue(issue);
    state.selectedIssueId = issue.id;
    if (issue.isLatest) markLatestIssue(issue.id);
    els.fileInput.value = "";
    const previewReady = Array.isArray(issue.pageUrls) && issue.pageUrls.length;
    setUploadStatus(previewReady ? "转换完成，可在线预览。" : "上传成功，已保存到历史归档。");
    closeUploadDialog();
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
  if (els.sidebarStatus) {
    els.sidebarStatus.textContent = message;
    els.sidebarStatus.hidden = !message;
  }
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

function formatMonthLabel(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;
  const [year, month] = monthKey.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function getIssuePreviewStatus(issue) {
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

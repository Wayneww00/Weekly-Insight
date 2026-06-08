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
};

const els = {
  currentList: document.querySelector("#current-list"),
  historyList: document.querySelector("#history-list"),
  viewerType: document.querySelector("#viewer-type"),
  viewerTitle: document.querySelector("#viewer-title"),
  viewerSummary: document.querySelector("#viewer-summary"),
  viewerContent: document.querySelector("#viewer-content"),
  uploadToggle: document.querySelector("#upload-toggle"),
  uploadForm: document.querySelector("#upload-form"),
  issueDate: document.querySelector("#issue-date"),
  category: document.querySelector("#category"),
  summary: document.querySelector("#summary"),
  fileInput: document.querySelector("#file-input"),
  fileName: document.querySelector("#file-name"),
  generatedTitle: document.querySelector("#generated-title"),
  formError: document.querySelector("#form-error"),
};

initialize();

function initialize() {
  state.selectedIssueId = latestIssue()?.id || state.issues[0]?.id || null;
  els.issueDate.value = new Date().toISOString().slice(0, 10);
  bindEvents();
  render();
}

function bindEvents() {
  els.uploadToggle.addEventListener("click", () => {
    els.uploadForm.hidden = !els.uploadForm.hidden;
  });

  document.querySelectorAll("[data-insight-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.insightType = button.dataset.insightType;
      document.querySelectorAll("[data-insight-type]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderGeneratedTitle();
    });
  });

  els.issueDate.addEventListener("change", renderGeneratedTitle);
  els.fileInput.addEventListener("change", (event) => {
    state.file = event.target.files?.[0] || null;
    els.fileName.textContent = state.file ? state.file.name : "选择文件";
  });
  els.uploadForm.addEventListener("submit", handleUpload);
}

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

function latestIssue() {
  return state.issues.find((issue) => issue.isLatest) || state.issues[0] || null;
}

function selectedIssue() {
  return state.issues.find((issue) => issue.id === state.selectedIssueId) || latestIssue();
}

function generateIssueTitle(issueDate, insightType) {
  if (!issueDate) return insightType === "weekly" ? "Weekly Insights" : "Monthly Insights";
  if (insightType === "monthly") return `${issueDate.slice(0, 7)} Monthly Insights`;
  return `${issueDate} Weekly Insights`;
}

function render() {
  renderGeneratedTitle();
  renderSidebar();
  renderViewer();
}

function renderGeneratedTitle() {
  els.generatedTitle.textContent = generateIssueTitle(els.issueDate.value, state.insightType);
}

function renderSidebar() {
  const current = latestIssue();
  const history = state.issues.filter((issue) => issue.id !== current?.id);
  els.currentList.innerHTML = current ? renderNavItem(current) : `<p class="empty-nav">暂无当前文件</p>`;
  els.historyList.innerHTML = history.length
    ? history.map(renderNavItem).join("")
    : `<p class="empty-nav">暂无历史文件</p>`;

  document.querySelectorAll("[data-issue-id]").forEach((item) => {
    item.addEventListener("click", () => {
      state.selectedIssueId = item.dataset.issueId;
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
        <small>${type} · ${escapeHtml(issue.category)}</small>
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
    els.viewerTitle.textContent = "Insight Hub";
    els.viewerSummary.textContent = "选择左侧文件查看 HTML/PDF 内容。";
    els.viewerContent.innerHTML = `<div class="empty-viewer">暂无内容</div>`;
    return;
  }

  els.viewerType.textContent = issue.insightType === "weekly" ? "Weekly Insight" : "Monthly Insight";
  els.viewerTitle.textContent = issue.category;
  els.viewerSummary.textContent = issue.summary || issue.title;

  const file = await getIssueFile(issue.id);
  els.viewerContent.innerHTML = renderHtmlDeck(issue, Boolean(file));
}

function renderHtmlDeck(issue, hasStoredFile) {
  const fileNote = hasStoredFile
    ? `<a class="deck-download" href="#" id="download-link">下载原文件</a>`
    : `<span class="deck-note">示例文件暂无本地原件</span>`;

  setTimeout(() => wireDownloadLink(issue), 0);

  return `
    <div class="deck-shell">
      <div class="deck-meta">
        <div>
          <strong>${escapeHtml(issue.title)}</strong>
          <span>PPT HTML View · ${escapeHtml(issue.fileName)}</span>
        </div>
        ${fileNote}
      </div>

      <div class="slide-stage">
        ${renderSlideCover(issue)}
        ${renderSlideOpportunity(issue)}
        ${renderSlideSummary(issue)}
      </div>
    </div>
  `;
}

function renderSlideCover(issue) {
  const period = issue.insightType === "monthly" ? issue.issueDate.slice(0, 7) : issue.issueDate;
  return `
    <section class="html-slide cover-slide">
      <div class="slide-topline">
        <span>${issue.insightType === "monthly" ? "Monthly Insight" : "Weekly Insight"}</span>
        <span>${escapeHtml(period)}</span>
      </div>
      <div class="slide-cover-grid">
        <div>
          <p class="slide-label">Insight Report</p>
          <h2>${escapeHtml(issue.title)}</h2>
          <p>${escapeHtml(issue.summary || "本期汇总核心市场信号、行业变化和需要关注的机会窗口。")}</p>
        </div>
        <div class="slide-visual">
          <span>Global</span>
          <strong>${escapeHtml(issue.category)}</strong>
          <small>HTML version converted from PPT</small>
        </div>
      </div>
    </section>
  `;
}

function renderSlideOpportunity(issue) {
  const chips = issue.tags.length ? issue.tags : ["Crypto 行业", "市场动态", "中影响"];
  return `
    <section class="html-slide content-slide">
      <div class="slide-topline">
        <span>${escapeHtml(issue.category)}</span>
        <span>01 / Market Signal</span>
      </div>
      <h2>现货比特币 ETF 延续负面趋势，五月份资金流出 24 亿美元</h2>
      <p class="slide-lead">
        分析师表示，对宏观经济环境改善的希望减弱，导致机构投资者从加密货币 ETF 转向人工智能股票。
      </p>
      <div class="slide-body-grid">
        <div class="slide-points">
          <div><strong>资金流向</strong><span>五月份 ETF 资金流出扩大，风险资产偏好下降。</span></div>
          <div><strong>影响判断</strong><span>短期价格波动加剧，机构配置节奏放缓。</span></div>
          <div><strong>观察窗口</strong><span>关注下周宏观数据与主要发行商申赎变化。</span></div>
        </div>
        <div class="slide-chart">
          <i style="height: 46%"></i>
          <i style="height: 72%"></i>
          <i style="height: 38%"></i>
          <i style="height: 58%"></i>
          <i style="height: 30%"></i>
        </div>
      </div>
      <div class="chips">${chips.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
    </section>
  `;
}

function renderSlideSummary(issue) {
  return `
    <section class="html-slide content-slide summary-slide">
      <div class="slide-topline">
        <span>${escapeHtml(issue.category)}</span>
        <span>02 / Executive View</span>
      </div>
      <h2>本期结论</h2>
      <div class="summary-grid">
        <article>
          <strong>机会</strong>
          <p>市场波动带来重新定价窗口，适合跟踪资金回流信号和政策变化。</p>
        </article>
        <article>
          <strong>风险</strong>
          <p>宏观预期和机构资金撤出仍可能压制短期情绪。</p>
        </article>
        <article>
          <strong>行动</strong>
          <p>下期重点补充 ETF 流向、竞品动作和区域市场事件。</p>
        </article>
      </div>
      <footer>Source: converted PPT HTML · ${escapeHtml(issue.fileName)}</footer>
    </section>
  `;
}

async function wireDownloadLink(issue) {
  const link = document.querySelector("#download-link");
  if (!link) return;
  const file = await getIssueFile(issue.id);
  if (!file) return;
  const url = URL.createObjectURL(file);
  link.href = url;
  link.download = issue.fileName;
}

async function handleUpload(event) {
  event.preventDefault();
  setError("");

  const file = state.file;
  if (!file) {
    setError("请选择 PPT、PPTX 或 PDF。");
    return;
  }

  if (!isAcceptedFile(file)) {
    setError("仅支持 .ppt、.pptx、.pdf。");
    return;
  }

  const now = new Date().toISOString();
  const issue = {
    id: crypto.randomUUID(),
    title: generateIssueTitle(els.issueDate.value, state.insightType),
    insightType: state.insightType,
    issueDate: els.issueDate.value,
    category: els.category.value.trim() || "Market Insight",
    summary: els.summary.value.trim(),
    tags: [],
    fileName: file.name,
    fileType: file.type || file.name.split(".").pop() || "unknown",
    fileSize: file.size,
    createdAt: now,
    updatedAt: now,
    isLatest: true,
  };

  try {
    await saveIssueFile(issue.id, file);
    state.issues = sortIssues([issue, ...state.issues.map((item) => ({ ...item, isLatest: false }))]);
    state.selectedIssueId = issue.id;
    saveIssues(state.issues);
    resetUploadForm();
    render();
  } catch {
    setError("文件保存失败，请重试。");
  }
}

function resetUploadForm() {
  state.file = null;
  els.fileInput.value = "";
  els.fileName.textContent = "选择文件";
  els.summary.value = "";
  els.uploadForm.hidden = true;
}

function isAcceptedFile(file) {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx") || lowerName.endsWith(".pdf");
}

function setError(message) {
  els.formError.textContent = message;
  els.formError.hidden = !message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

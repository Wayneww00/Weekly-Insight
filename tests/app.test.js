const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createElement() {
  return {
    classList: { add() {}, remove() {} },
    dataset: {},
    hidden: false,
    innerHTML: "",
    textContent: "",
    value: "",
    addEventListener() {},
  };
}

function createSuccessfulUploadXHR() {
  return class SuccessfulUploadXHR {
    constructor() {
      this.status = 200;
      this.responseText = "";
      this.upload = { addEventListener: (event, callback) => { this[`upload_${event}`] = callback; } };
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader() {}

    addEventListener(event, callback) {
      this[`event_${event}`] = callback;
    }

    send(file) {
      setTimeout(() => {
        this.upload_progress?.({
          lengthComputable: true,
          loaded: file?.size || 0,
          total: file?.size || 0,
        });
        this.event_load?.();
      }, 0);
    }
  };
}

function loadApp(options = {}) {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, createElement());
      return elements.get(selector);
    },
    querySelectorAll() {
      return [];
    },
  };

  const localStorage = {
    data: new Map(),
    getItem(key) {
      return this.data.has(key) ? this.data.get(key) : null;
    },
    setItem(key, value) {
      this.data.set(key, String(value));
    },
    removeItem(key) {
      this.data.delete(key);
    },
  };

  const indexedDB = {
    open() {
      const request = {};
      setTimeout(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          transaction() {
            return {
              objectStore() {
                return {
                  get() {
                    const getRequest = {};
                    setTimeout(() => {
                      getRequest.result = null;
                      getRequest.onsuccess?.();
                    }, 0);
                    return getRequest;
                  },
                  put() {
                    const putRequest = {};
                    setTimeout(() => {
                      putRequest.result = undefined;
                      putRequest.onsuccess?.();
                    }, 0);
                    return putRequest;
                  },
                };
              },
              oncomplete: null,
              onerror: null,
            };
          },
          close() {},
        };
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };

  const code = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
  const context = {
    console: options.console || { ...console, error() {} },
    document,
    indexedDB,
    localStorage,
    setTimeout: (callback) => setTimeout(callback, 0),
    setInterval: () => 1,
    clearInterval() {},
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    URLSearchParams,
    fetch: options.fetch,
    XMLHttpRequest: options.XMLHttpRequest || createSuccessfulUploadXHR(),
  };
  vm.createContext(context);
  vm.runInContext(
    `${code}
globalThis.__appTest = {
  els,
  state,
  getFilteredIssues,
  generateIssueTitle,
  getIssueDisplayTitle,
  getIssueDisplayMeta,
  renderViewerSummary,
  renderViewerMeta,
  renderPreview,
  getConversionProgress,
  bindSlideReader,
  handleUpload: typeof handleUpload === "function" ? handleUpload : undefined,
  setSelectedFile,
  formatUploadProgress,
  isAcceptedFile,
  retryIssue: typeof retryIssue === "function" ? retryIssue : undefined
};`,
    context
  );
  return context.__appTest;
}

test("defines the upload workflow handler used by file input and dropzone", () => {
  const app = loadApp();
  assert.equal(typeof app.handleUpload, "function");
});

test("search covers title, summary, category, and tags", () => {
  const app = loadApp();
  app.state.issues = [
    {
      id: "search-monthly",
      title: "2026-05 Monthly Insights",
      insightType: "monthly",
      issueDate: "2026-05-01",
      summary: "五月月度洞察复盘消费科技新品。",
      category: "竞品资讯",
      tags: ["Consumer"],
      fileName: "monthly.pdf",
      createdAt: "2026-05-31T09:00:00.000Z",
    },
    {
      id: "search-weekly",
      title: "2026-05-18 Weekly Insights",
      insightType: "weekly",
      issueDate: "2026-05-18",
      summary: "本期覆盖 AI 产品更新和算力基础设施趋势。",
      category: "AI 新闻",
      tags: ["高影响"],
      fileName: "weekly.pdf",
      createdAt: "2026-05-18T09:00:00.000Z",
    },
  ];

  app.state.searchQuery = "竞品";
  assert.equal(app.getFilteredIssues().map((issue) => issue.id).join(","), "search-monthly");

  app.state.searchQuery = "高影响";
  assert.equal(app.getFilteredIssues().map((issue) => issue.id).join(","), "search-weekly");

  app.state.searchQuery = "基础设施";
  assert.equal(app.getFilteredIssues().map((issue) => issue.id).join(","), "search-weekly");
});

test("accepts only ppt, pptx, and pdf uploads by extension", () => {
  const app = loadApp();
  assert.equal(app.isAcceptedFile({ name: "weekly.pdf" }), true);
  assert.equal(app.isAcceptedFile({ name: "monthly.PPTX" }), true);
  assert.equal(app.isAcceptedFile({ name: "notes.docx" }), false);
});

test("upload creates a dated issue without category or summary fields", async () => {
  const app = loadApp({
    fetch: async (url) => {
      if (String(url).startsWith("/api/issue")) {
        return {
          ok: true,
          json: async () => ({
            issue: {
              id: "server-upload-1",
              title: "2026-06-09 Weekly Insights",
              insightType: "weekly",
              issueDate: "2026-06-09",
              category: "",
              summary: "",
              tags: [],
              fileName: "weekly-insight.pdf",
              fileType: "application/pdf",
              fileSize: 2048,
              originalUrl: "/storage/uploads/server-upload-1/original/weekly-insight.pdf",
              previewUrl: "",
              pageUrls: [],
              conversionStatus: "ready",
              conversionMessage: "发布完成，可在线预览。",
              status: "published",
              createdAt: "2026-06-09T00:00:00.000Z",
              updatedAt: "2026-06-09T00:00:00.000Z",
              isLatest: true,
            },
          }),
        };
      }
      if (String(url) === "/api/upload/initiate") {
        return {
          ok: true,
          json: async () => ({
            uploadUrl: "https://storage.googleapis.com/upload-session",
            issue: {
              id: "server-upload-1",
              title: "2026-06-09 Weekly Insights",
              insightType: "weekly",
              issueDate: "2026-06-09",
              category: "",
              summary: "",
              tags: [],
              fileName: "weekly-insight.pdf",
              fileType: "application/pdf",
              fileSize: 2048,
              originalUrl: "/storage/uploads/server-upload-1/original/weekly-insight.pdf",
              previewUrl: "",
              pageUrls: [],
              conversionStatus: "queued",
              conversionMessage: "已上传，等待生成在线预览。",
              status: "processing",
              createdAt: "2026-06-09T00:00:00.000Z",
              updatedAt: "2026-06-09T00:00:00.000Z",
              isLatest: true,
            },
          }),
        };
      }
      if (String(url) === "/api/upload/complete") {
        return {
          ok: true,
          json: async () => ({
            issue: {
              id: "server-upload-1",
              title: "2026-06-09 Weekly Insights",
              insightType: "weekly",
              issueDate: "2026-06-09",
              category: "",
              summary: "",
              tags: [],
              fileName: "weekly-insight.pdf",
              fileType: "application/pdf",
              fileSize: 2048,
              originalUrl: "/storage/uploads/server-upload-1/original/weekly-insight.pdf",
              previewUrl: "",
              pageUrls: [],
              conversionStatus: "queued",
              conversionMessage: "已上传，等待生成在线预览。",
              status: "processing",
              createdAt: "2026-06-09T00:00:00.000Z",
              updatedAt: "2026-06-09T00:00:00.000Z",
              isLatest: true,
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ issues: [] }) };
    },
  });
  app.els.issueDate.value = "2026-06-09";
  app.els.markLatest.checked = true;

  await app.handleUpload({
    name: "weekly-insight.pdf",
    type: "application/pdf",
    size: 2048,
  });

  const uploaded = app.state.issues.find((issue) => issue.fileName === "weekly-insight.pdf");
  assert.equal(uploaded.title, "2026-06-09 Weekly Insights");
  assert.equal(uploaded.category, "");
  assert.equal(uploaded.summary, "");
  assert.equal(uploaded.isLatest, true);
  assert.equal(app.state.issues.filter((issue) => issue.isLatest).length, 1);
  assert.equal(app.els.selectedFile.hidden, false);
  assert.equal(app.els.selectedFile.innerHTML.includes("weekly-insight.pdf"), true);
});

test("failed server upload does not create a fake local issue", async () => {
  const app = loadApp({
    fetch: async (url) => {
      if (String(url) === "/api/upload/initiate") {
        return {
          ok: false,
          json: async () => ({ error: "Upload failed." }),
        };
      }
      return { ok: true, json: async () => ({ issues: [] }) };
    },
  });
  app.els.issueDate.value = "2026-04-30";
  app.els.markLatest.checked = true;

  await app.handleUpload({
    name: "Market Trends (Apr 2026).pdf",
    type: "application/pdf",
    size: 38300000,
  });

  assert.equal(app.state.issues.some((issue) => issue.fileName === "Market Trends (Apr 2026).pdf"), false);
  assert.equal(app.els.uploadStatus.textContent, "Upload failed.");
});

test("selected upload file can show progress feedback", () => {
  const app = loadApp();
  app.setSelectedFile(
    {
      name: "Market Trends (May 2026).pdf",
      size: 35000000,
    },
    "正在上传 42%",
    { progress: 42 }
  );

  assert.equal(app.els.selectedFile.hidden, false);
  assert.equal(app.els.selectedFile.innerHTML.includes("Market Trends (May 2026).pdf"), true);
  assert.equal(app.els.selectedFile.innerHTML.includes("正在上传 42%"), true);
  assert.equal(app.els.selectedFile.innerHTML.includes("selected-file-progress"), true);
  assert.equal(app.els.selectedFile.innerHTML.includes("width: 42%"), true);
});

test("upload progress labels expose clear publishing phases", () => {
  const app = loadApp();
  const startedAt = Date.now();

  assert.equal(app.formatUploadProgress({ phase: "uploading", percent: 42, loaded: 42, total: 100 }, startedAt).label.includes("正在上传 42%"), true);
  assert.equal(app.formatUploadProgress({ phase: "converting" }, startedAt).label, "上传完成，正在转换 PPT...");
  assert.equal(app.formatUploadProgress({ phase: "rendering" }, startedAt).label, "正在生成高清预览...");
  assert.equal(app.formatUploadProgress({ phase: "published" }, startedAt).label, "发布完成");
});

test("processing issues render an explicit background status", () => {
  const app = loadApp();
  const html = app.renderPreview(
    {
      title: "2026-06-09 Weekly Insights",
      fileName: "weekly.pptx",
      fileType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      fileSize: 2048,
      status: "processing",
      conversionStatus: "converting",
      conversionMessage: "正在转换 PPT 为 PDF。",
      pageUrls: [],
    },
    null
  );

  assert.equal(html.includes("processing-card"), true);
  assert.equal(html.includes("正在转换 PPT"), true);
  assert.equal(html.includes("正在转换 PPT 为 PDF。"), true);
});

test("processing preview exposes conversion progress", () => {
  const app = loadApp();
  const html = app.renderPreview(
    {
      title: "2026-06-12 Weekly Insights",
      fileName: "weekly.pdf",
      fileType: "application/pdf",
      fileSize: 4096,
      status: "processing",
      conversionStatus: "rendering",
      conversionMessage: "正在生成高清在线预览：7 / 25 页。",
      conversionProgress: {
        phase: "rendering",
        percent: 28,
        processedPages: 7,
        totalPages: 25,
      },
      pageUrls: [],
    },
    null
  );

  assert.equal(html.includes("conversion-progress"), true);
  assert.equal(html.includes("28%"), true);
  assert.equal(html.includes("已完成 7 / 25 页"), true);
});

test("failed previews expose a retry action instead of only a download fallback", () => {
  const app = loadApp();
  const html = app.renderPreview(
    {
      id: "failed-issue",
      title: "2026-06-12 Weekly Insights",
      fileName: "weekly.pdf",
      fileType: "application/pdf",
      fileSize: 4096,
      status: "failed",
      conversionStatus: "failed",
      conversionMessage: "PDF 页面渲染失败",
      pageUrls: [],
    },
    null
  );

  assert.equal(html.includes("data-retry-preview=\"failed-issue\""), true);
  assert.equal(html.includes("重新生成预览"), true);
  assert.equal(typeof app.retryIssue, "function");
});

test("renders converted ppt preview when a pdf preview url exists", () => {
  const app = loadApp();
  const issue = {
    title: "2026-06-09 Weekly Insights",
    fileName: "weekly.pptx",
    insightType: "weekly",
    issueDate: "2026-06-09",
    fileType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    fileSize: 2048,
    previewUrl: "/data/uploads/issue-1/weekly.pdf",
    originalUrl: "/data/uploads/issue-1/weekly.pptx",
  };
  const meta = app.renderViewerMeta(issue, issue.originalUrl);
  const summary = app.renderViewerSummary(issue);
  const html = app.renderPreview(issue, null);

  assert.equal(app.getIssueDisplayTitle(issue), "weekly");
  assert.equal(app.getIssueDisplayMeta(issue), "2026-06-09 · Weekly Insight");
  assert.equal(summary, "2026-06-09 · Weekly Insight");
  assert.equal(summary.includes("已转 PDF"), false);
  assert.equal(summary.includes("2 KB"), false);
  assert.equal(meta.includes("PPTX"), false);
  assert.equal(meta.includes("2 KB"), false);
  assert.equal(meta.includes("data-preview-fullscreen"), true);
  assert.equal(meta.includes("meta-download"), true);
  assert.equal(html.includes("data-exit-fullscreen"), false);
  assert.equal(html.includes("preview-toolbar"), false);
  assert.equal(html.includes("weekly.pdf"), true);
});

test("renders custom continuous reader instead of browser pdf viewer when page images exist", () => {
  const app = loadApp();
  const html = app.renderPreview(
    {
      title: "2026-06-09 Weekly Insights",
      fileName: "weekly.pptx",
      fileType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      fileSize: 2048,
      previewUrl: "/data/uploads/issue-1/weekly.pdf",
      originalUrl: "/data/uploads/issue-1/weekly.pptx",
      pageUrls: ["/data/uploads/issue-1/pages/page-1.png", "/data/uploads/issue-1/pages/page-2.png"],
    },
    null
  );

  assert.equal(html.includes("slide-reader"), true);
  assert.equal(html.includes("data-slide-image"), true);
  assert.equal(html.includes("slide-thumbnails"), true);
  assert.equal(html.includes("data-toggle-thumbnails"), true);
  assert.equal(html.includes("slide-edge-zone"), true);
  assert.equal((html.match(/data-slide-thumb/g) || []).length, 2);
  assert.equal((html.match(/data-slide-page/g) || []).length, 2);
  assert.equal(html.includes("pdf-embed"), false);
  assert.equal(html.includes("slide-controls"), false);
  assert.equal(html.includes("data-slide-count"), false);
});

test("slide thumbnails use lightweight thumbnail urls while pages keep high resolution urls", () => {
  const app = loadApp();
  const html = app.renderPreview(
    {
      title: "2026-06-09 Weekly Insights",
      fileName: "weekly.pdf",
      fileType: "application/pdf",
      fileSize: 2048,
      pageUrls: ["/storage/uploads/issue-1/pages/page-01.png", "/storage/uploads/issue-1/pages/page-02.png"],
      thumbUrls: ["/storage/uploads/issue-1/thumbs/page-01.png", "/storage/uploads/issue-1/thumbs/page-02.png"],
    },
    null
  );

  assert.equal(html.includes("src=\"/storage/uploads/issue-1/thumbs/page-01.png\""), true);
  assert.equal(html.includes("src=\"/storage/uploads/issue-1/pages/page-01.png\""), true);
});

test("slide reader binding keeps keyboard navigation without hijacking native scroll", () => {
  const app = loadApp();
  assert.equal(typeof app.bindSlideReader, "function");
  const html = app.renderPreview(
    {
      title: "2026-06-09 Weekly Insights",
      fileName: "weekly.pptx",
      fileType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      fileSize: 2048,
      pageUrls: ["/page-1.png", "/page-2.png"],
    },
    null
  );

  assert.equal(html.includes("tabindex=\"0\""), true);
  assert.equal(html.includes("data-slide-reader"), true);
  assert.equal(html.includes("data-slide-page=\"1\""), true);
});

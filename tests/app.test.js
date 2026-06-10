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

function loadApp() {
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
    console,
    document,
    indexedDB,
    localStorage,
    setTimeout,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
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
  bindSlideReader,
  handleUpload: typeof handleUpload === "function" ? handleUpload : undefined,
  isAcceptedFile
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
  const app = loadApp();
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

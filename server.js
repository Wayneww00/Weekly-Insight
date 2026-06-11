const http = require("node:http");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dataRoot = path.join(root, "data");
const uploadsRoot = path.join(dataRoot, "uploads");
const dbPath = path.join(dataRoot, "db.json");
const previewDpi = Number(process.env.PREVIEW_DPI || 300);
const execFileAsync = promisify(execFile);

const conversionQueue = [];
let conversionRunning = false;
let dbWriteQueue = Promise.resolve();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://localhost:${port}`);

    if (request.method === "GET" && url.pathname === "/api/issues") {
      await handleListIssuesRequest(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/issue") {
      await handleGetIssueRequest(url, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/issues/import") {
      await handleImportIssuesRequest(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/upload") {
      await handleUploadRequest(request, url, response);
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/api/issue") {
      await handleDeleteIssueRequest(url, response);
      return;
    }

    serveStatic(request, response);
  } catch (error) {
    writeJson(response, 500, { error: "Server error.", message: error.message });
  }
});

async function handleListIssuesRequest(response) {
  const db = await readDb();
  writeJson(response, 200, {
    issues: sortIssues(db.issues.filter((issue) => !issue.deletedAt)),
  });
}

async function handleGetIssueRequest(url, response) {
  const issueId = sanitizeSegment(url.searchParams.get("issueId") || "");
  const db = await readDb();
  const issue = db.issues.find((item) => item.id === issueId && !item.deletedAt);

  if (!issue) {
    writeJson(response, 404, { error: "Issue not found." });
    return;
  }

  writeJson(response, 200, { issue });
}

async function handleImportIssuesRequest(request, response) {
  const payload = await readJsonBody(request);
  const incomingIssues = Array.isArray(payload.issues) ? payload.issues : [];
  const importedIds = [];

  await updateDb((db) => {
    incomingIssues.forEach((rawIssue) => {
      const issue = normalizeImportedIssue(rawIssue);
      if (!issue || db.issues.some((item) => item.id === issue.id)) return;
      db.issues.push(issue);
      importedIds.push(issue.id);
    });
    db.issues = sortIssues(db.issues);
  });

  writeJson(response, 200, { importedIds });
}

async function handleUploadRequest(request, url, response) {
  const issueId = sanitizeSegment(url.searchParams.get("issueId") || "");
  const rawFileName = url.searchParams.get("fileName") || "upload.bin";
  const fileName = sanitizeFileName(rawFileName);
  const insightType = url.searchParams.get("insightType") === "monthly" ? "monthly" : "weekly";
  const issueDate = sanitizeDate(url.searchParams.get("issueDate") || "");
  const fileType = url.searchParams.get("fileType") || mimeTypes[path.extname(fileName).toLowerCase()] || "application/octet-stream";
  const fileSize = Number(url.searchParams.get("fileSize") || 0);
  const isLatest = url.searchParams.get("isLatest") === "true";

  if (!issueId || !fileName || !issueDate) {
    writeJson(response, 400, { error: "Missing issue id, file name, or issue date." });
    return;
  }

  const ext = path.extname(fileName).toLowerCase();
  if (![".ppt", ".pptx", ".pdf"].includes(ext)) {
    writeJson(response, 400, { error: "Unsupported file type." });
    return;
  }

  const uploadDir = path.join(uploadsRoot, issueId);
  const originalPath = path.join(uploadDir, fileName);
  const now = new Date().toISOString();
  const originalUrl = `/data/uploads/${issueId}/${encodeURIComponent(fileName)}`;
  const issue = {
    id: issueId,
    title: generateIssueTitle(issueDate, insightType),
    insightType,
    issueDate,
    category: "",
    summary: "",
    tags: [],
    fileName,
    fileType,
    fileSize,
    originalUrl,
    previewUrl: "",
    pageUrls: [],
    conversionStatus: "queued",
    conversionMessage: "已上传，等待生成在线预览。",
    status: "processing",
    uploaderId: "local-user",
    publishedAt: "",
    createdAt: now,
    updatedAt: now,
    deletedAt: "",
    isLatest,
  };

  try {
    await fs.promises.mkdir(uploadDir, { recursive: true });
    await writeRequestBody(request, originalPath);
    await upsertIssue(issue);
    await upsertAsset({
      id: `${issueId}-original`,
      issueId,
      type: "original",
      url: originalUrl,
      pageNumber: null,
      mimeType: fileType,
      size: fileSize,
      createdAt: now,
    });
    enqueueConversion(issueId);
    writeJson(response, 202, { issue });
  } catch (error) {
    await updateIssue(issueId, {
      status: "failed",
      conversionStatus: "failed",
      conversionMessage: error.message,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
    writeJson(response, 500, {
      error: "Upload failed.",
      conversionStatus: "failed",
      conversionMessage: error.message,
    });
  }
}

async function handleDeleteIssueRequest(url, response) {
  const issueId = sanitizeSegment(url.searchParams.get("issueId") || "");

  if (!issueId) {
    writeJson(response, 400, { error: "Missing issue id." });
    return;
  }

  const deletedAt = new Date().toISOString();
  await updateDb((db) => {
    const issue = db.issues.find((item) => item.id === issueId);
    if (!issue) return;
    issue.status = "deleted";
    issue.deletedAt = deletedAt;
    issue.updatedAt = deletedAt;
    issue.isLatest = false;
    db.assets.forEach((asset) => {
      if (asset.issueId === issueId) asset.deletedAt = deletedAt;
    });
    const nextLatest = sortIssues(db.issues.filter((item) => !item.deletedAt))[0];
    if (nextLatest) nextLatest.isLatest = true;
  });
  writeJson(response, 200, { ok: true });
}

function enqueueConversion(issueId) {
  if (!conversionQueue.includes(issueId)) conversionQueue.push(issueId);
  runConversionQueue();
}

async function runConversionQueue() {
  if (conversionRunning) return;
  conversionRunning = true;

  while (conversionQueue.length) {
    const issueId = conversionQueue.shift();
    try {
      await processConversion(issueId);
    } catch (error) {
      await updateIssue(issueId, {
        status: "failed",
        conversionStatus: "failed",
        conversionMessage: error.message,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  }

  conversionRunning = false;
}

async function processConversion(issueId) {
  const db = await readDb();
  const issue = db.issues.find((item) => item.id === issueId && !item.deletedAt);
  if (!issue) return;

  const uploadDir = path.join(uploadsRoot, issueId);
  const originalPath = path.join(uploadDir, issue.fileName);
  const ext = path.extname(issue.fileName).toLowerCase();
  let previewUrl = ext === ".pdf" ? issue.originalUrl : "";
  let pdfPath = ext === ".pdf" ? originalPath : "";

  if (ext === ".ppt" || ext === ".pptx") {
    await updateIssue(issueId, {
      status: "processing",
      conversionStatus: "converting",
      conversionMessage: "正在转换 PPT 为 PDF。",
      updatedAt: new Date().toISOString(),
    });
    const conversion = await convertPresentationToPdf(originalPath, uploadDir);
    if (conversion.status !== "ready") {
      await updateIssue(issueId, {
        status: "failed",
        conversionStatus: conversion.status,
        conversionMessage: conversion.message,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    previewUrl = `/data/uploads/${issueId}/${conversion.previewUrl}`;
    pdfPath = path.join(uploadDir, decodeURIComponent(path.basename(conversion.previewUrl)));
    const pdfStat = await fs.promises.stat(pdfPath).catch(() => null);
    await upsertAsset({
      id: `${issueId}-pdf`,
      issueId,
      type: "pdf",
      url: previewUrl,
      pageNumber: null,
      mimeType: "application/pdf",
      size: pdfStat?.size || 0,
      createdAt: new Date().toISOString(),
    });
  }

  await updateIssue(issueId, {
    status: "processing",
    previewUrl,
    conversionStatus: "rendering",
    conversionMessage: "正在生成高清在线预览。",
    updatedAt: new Date().toISOString(),
  });
  const pageUrls = await renderPdfPages(pdfPath, uploadDir, issueId);
  const now = new Date().toISOString();
  await updateDb((nextDb) => {
    const nextIssue = nextDb.issues.find((item) => item.id === issueId);
    if (!nextIssue || nextIssue.deletedAt) return;
    nextIssue.previewUrl = previewUrl;
    nextIssue.pageUrls = pageUrls;
    nextIssue.status = "published";
    nextIssue.conversionStatus = "ready";
    nextIssue.conversionMessage = "发布完成，可在线预览。";
    nextIssue.publishedAt = nextIssue.publishedAt || now;
    nextIssue.updatedAt = now;
    pageUrls.forEach((pageUrl, index) => {
      upsertAssetInDb(nextDb, {
        id: `${issueId}-page-${index + 1}`,
        issueId,
        type: "pageImage",
        url: pageUrl,
        pageNumber: index + 1,
        mimeType: "image/png",
        size: 0,
        createdAt: now,
      });
    });
  });
}

async function renderPdfPages(pdfPath, uploadDir, issueId) {
  const pagesDir = path.join(uploadDir, "pages");
  await fs.promises.rm(pagesDir, { recursive: true, force: true });
  await fs.promises.mkdir(pagesDir, { recursive: true });

  await execFileAsync("pdftoppm", ["-png", "-r", String(previewDpi), pdfPath, path.join(pagesDir, "page")], {
    timeout: 300000,
  });

  const pageFiles = (await fs.promises.readdir(pagesDir))
    .filter((fileName) => /^page-\d+\.png$/.test(fileName))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));

  return pageFiles.map((fileName) => `/data/uploads/${issueId}/pages/${encodeURIComponent(fileName)}`);
}

function writeRequestBody(request, filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    request.pipe(stream);
    request.on("error", reject);
    stream.on("error", reject);
    stream.on("finish", resolve);
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

async function convertPresentationToPdf(originalPath, uploadDir) {
  const soffice = await findSoffice();
  if (!soffice) {
    return {
      status: "failed",
      message: "未检测到 LibreOffice，无法把 PPT/PPTX 转成 PDF 预览。请在服务器安装 LibreOffice 后重新上传。",
      previewUrl: "",
    };
  }

  try {
    await execFileAsync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", uploadDir, originalPath], {
      timeout: 300000,
    });
    const convertedName = `${path.basename(originalPath, path.extname(originalPath))}.pdf`;
    const convertedPath = path.join(uploadDir, convertedName);
    await fs.promises.access(convertedPath, fs.constants.R_OK);
    return {
      status: "ready",
      message: "PPT 已转换为 PDF，可在线预览。",
      previewUrl: encodeURIComponent(convertedName),
    };
  } catch (error) {
    return {
      status: "failed",
      message: `PPT 转换失败：${error.message}`,
      previewUrl: "",
    };
  }
}

async function findSoffice() {
  const candidates = [
    process.env.SOFFICE_PATH,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "soffice",
    "libreoffice",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 5000 });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return "";
}

async function ensureDb() {
  await fs.promises.mkdir(dataRoot, { recursive: true });
  await fs.promises.mkdir(uploadsRoot, { recursive: true });
  try {
    await fs.promises.access(dbPath, fs.constants.R_OK);
  } catch {
    await fs.promises.writeFile(dbPath, JSON.stringify({ issues: [], assets: [] }, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  const raw = await fs.promises.readFile(dbPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return {
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
    };
  } catch {
    return { issues: [], assets: [] };
  }
}

async function writeDb(db) {
  await ensureDb();
  await fs.promises.writeFile(dbPath, JSON.stringify({
    issues: sortIssues(db.issues || []),
    assets: db.assets || [],
  }, null, 2));
}

async function updateDb(mutator) {
  dbWriteQueue = dbWriteQueue.then(async () => {
    const db = await readDb();
    await mutator(db);
    await writeDb(db);
    return db;
  });
  return dbWriteQueue;
}

async function upsertIssue(issue) {
  await updateDb((db) => {
    if (issue.isLatest) {
      db.issues.forEach((item) => {
        if (!item.deletedAt) item.isLatest = false;
      });
    }
    upsertIssueInDb(db, issue);
  });
}

function upsertIssueInDb(db, issue) {
  const existingIndex = db.issues.findIndex((item) => item.id === issue.id);
  if (existingIndex >= 0) {
    db.issues[existingIndex] = { ...db.issues[existingIndex], ...issue };
  } else {
    db.issues.push(issue);
  }
  db.issues = sortIssues(db.issues);
}

async function updateIssue(issueId, patch) {
  await updateDb((db) => {
    const issue = db.issues.find((item) => item.id === issueId);
    if (!issue) return;
    Object.assign(issue, patch);
  });
}

async function upsertAsset(asset) {
  await updateDb((db) => upsertAssetInDb(db, asset));
}

function upsertAssetInDb(db, asset) {
  const existingIndex = db.assets.findIndex((item) => item.id === asset.id);
  if (existingIndex >= 0) {
    db.assets[existingIndex] = { ...db.assets[existingIndex], ...asset };
  } else {
    db.assets.push(asset);
  }
}

function normalizeImportedIssue(rawIssue) {
  if (!rawIssue || typeof rawIssue !== "object") return null;
  const id = sanitizeSegment(rawIssue.id || "");
  const fileName = sanitizeFileName(rawIssue.fileName || "");
  const issueDate = sanitizeDate(rawIssue.issueDate || "");
  if (!id || !fileName || !issueDate) return null;
  const insightType = rawIssue.insightType === "monthly" ? "monthly" : "weekly";
  return {
    id,
    title: rawIssue.title || generateIssueTitle(issueDate, insightType),
    insightType,
    issueDate,
    category: rawIssue.category || "",
    summary: rawIssue.summary || "",
    tags: Array.isArray(rawIssue.tags) ? rawIssue.tags : [],
    fileName,
    fileType: rawIssue.fileType || mimeTypes[path.extname(fileName).toLowerCase()] || "application/octet-stream",
    fileSize: Number(rawIssue.fileSize || 0),
    originalUrl: rawIssue.originalUrl || "",
    previewUrl: rawIssue.previewUrl || "",
    pageUrls: Array.isArray(rawIssue.pageUrls) ? rawIssue.pageUrls : [],
    conversionStatus: rawIssue.conversionStatus || (rawIssue.pageUrls?.length ? "ready" : "queued"),
    conversionMessage: rawIssue.conversionMessage || "",
    status: rawIssue.status || (rawIssue.pageUrls?.length ? "published" : "processing"),
    uploaderId: rawIssue.uploaderId || "local-user",
    publishedAt: rawIssue.publishedAt || "",
    createdAt: rawIssue.createdAt || new Date().toISOString(),
    updatedAt: rawIssue.updatedAt || new Date().toISOString(),
    deletedAt: rawIssue.deletedAt || "",
    isLatest: Boolean(rawIssue.isLatest),
  };
}

function serveStatic(request, response) {
  const requestPath = decodeURIComponent(new URL(request.url || "/", `http://localhost:${port}`).pathname);
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
}

function generateIssueTitle(issueDate, insightType) {
  if (!issueDate) return insightType === "weekly" ? "Weekly Insights" : "Monthly Insights";
  if (insightType === "monthly") return `${issueDate.slice(0, 7)} Monthly Insights`;
  return `${issueDate} Weekly Insights`;
}

function sortIssues(issues) {
  return [...issues].sort((a, b) => {
    if (a.issueDate === b.issueDate) return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    return String(b.issueDate || "").localeCompare(String(a.issueDate || ""));
  });
}

function sanitizeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function sanitizeFileName(value) {
  return path.basename(String(value)).replace(/[^\w.\- ()\u4e00-\u9fff]/g, "_");
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

ensureDb().then(() => {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Insight Hub running at http://127.0.0.1:${port}`);
  });
});

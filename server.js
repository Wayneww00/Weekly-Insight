const http = require("node:http");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { Storage } = require("@google-cloud/storage");
const { authenticateUser, findUserByEmail, getAuthConfig, safeEqual } = require("./auth-config");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const dataRoot = path.join(root, "data");
const uploadsRoot = path.join(dataRoot, "uploads");
const dbPath = path.join(dataRoot, "db.json");
const previewDpi = Number(process.env.PREVIEW_DPI || 300);
const thumbnailDpi = Number(process.env.THUMBNAIL_DPI || 42);
const conversionTimeoutMs = Number(process.env.CONVERSION_TIMEOUT_MS || 900000);
const gcsBucketName = process.env.GCS_BUCKET || "";
const isCloudStorageEnabled = Boolean(gcsBucketName);
const execFileAsync = promisify(execFile);
const storage = isCloudStorageEnabled ? new Storage() : null;

const conversionQueue = [];
let conversionRunning = false;
let dbWriteQueue = Promise.resolve();
const loginAttempts = new Map();
const sessionDurationSeconds = 60 * 60 * 24 * 7;

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

    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      handleSessionRequest(request, response);
      return;
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      await handleLoginRequest(request, response);
      return;
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      handleLogoutRequest(request, response);
      return;
    }

    if ((url.pathname.startsWith("/api/") || url.pathname.startsWith("/storage/") || url.pathname.startsWith("/data/")) && !requireAuthenticatedSession(request, response)) {
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/issues") {
      await handleListIssuesRequest(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/issue") {
      await handleGetIssueRequest(url, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/issues/import") {
      if (!requireAdminSession(request, response)) return;
      await handleImportIssuesRequest(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/upload") {
      if (!requireAdminSession(request, response)) return;
      await handleUploadRequest(request, url, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/upload/initiate") {
      if (!requireAdminSession(request, response)) return;
      await handleUploadInitiateRequest(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/upload/complete") {
      if (!requireAdminSession(request, response)) return;
      await handleUploadCompleteRequest(request, response);
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/api/issue") {
      if (!requireAdminSession(request, response)) return;
      await handleDeleteIssueRequest(url, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/issue/retry") {
      if (!requireAdminSession(request, response)) return;
      await handleRetryIssueRequest(url, response);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/storage/")) {
      await serveStorageObject(url, response);
      return;
    }

    serveStatic(request, response);
  } catch (error) {
    writeJson(response, 500, { error: "Server error.", message: error.message });
  }
});

function handleSessionRequest(request, response) {
  const session = getSessionFromRequest(request);
  if (!session) {
    writeJson(response, 401, { error: "未登录。" });
    return;
  }
  writeJson(response, 200, { user: { email: session.email, role: session.role } });
}

async function handleLoginRequest(request, response) {
  const config = getAuthConfig();
  if (!config.isConfigured) {
    writeJson(response, 503, { error: "登录服务尚未配置。请联系管理员设置 INSIGHT_AUTH_PASSWORD 和 SESSION_SECRET。" });
    return;
  }

  const attemptKey = getClientAddress(request);
  const attempt = loginAttempts.get(attemptKey);
  if (attempt?.blockedUntil > Date.now()) {
    writeJson(response, 429, { error: "登录尝试次数过多，请 15 分钟后再试。" });
    return;
  }

  const payload = await readJsonBody(request);
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const user = authenticateUser(config, email, password);

  if (!user) {
    registerFailedLogin(attemptKey);
    writeJson(response, 401, { error: "邮箱或密码不正确。" });
    return;
  }

  loginAttempts.delete(attemptKey);
  setSessionCookie(request, response, createSession(user, config.secret));
  writeJson(response, 200, { user });
}

function handleLogoutRequest(request, response) {
  clearSessionCookie(request, response);
  writeJson(response, 200, { ok: true });
}

function requireAuthenticatedSession(request, response) {
  const session = getSessionFromRequest(request);
  if (session) {
    request.authSession = session;
    return true;
  }
  if ((request.url || "").startsWith("/api/")) {
    writeJson(response, 401, { error: "请先登录。" });
  } else {
    response.writeHead(401, { "Cache-Control": "no-store" });
    response.end("Unauthorized");
  }
  return false;
}

function requireAdminSession(request, response) {
  const session = request.authSession || getSessionFromRequest(request);
  if (session?.role === "admin") return session;
  writeJson(response, 403, { error: "当前账号没有内容管理权限。" });
  return null;
}

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
  const uploadMetadata = normalizeUploadMetadata({
    issueId: url.searchParams.get("issueId"),
    fileName: url.searchParams.get("fileName"),
    insightType: url.searchParams.get("insightType"),
    issueDate: url.searchParams.get("issueDate"),
    fileType: url.searchParams.get("fileType"),
    fileSize: url.searchParams.get("fileSize"),
    isLatest: url.searchParams.get("isLatest"),
  });

  if (uploadMetadata.error) {
    writeJson(response, uploadMetadata.statusCode, { error: uploadMetadata.error });
    return;
  }

  const { issue, originalObjectName, uploadDir, originalPath } = buildUploadIssue(uploadMetadata);

  try {
    if (isCloudStorageEnabled) {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `insight-upload-${issue.id}-`));
      const tempPath = path.join(tempDir, issue.fileName);
      await writeRequestBody(request, tempPath);
      await uploadFileToStorage(tempPath, originalObjectName, issue.fileType);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } else {
      await fs.promises.mkdir(uploadDir, { recursive: true });
      await writeRequestBody(request, originalPath);
    }
    await registerUploadedIssue(issue);
    writeJson(response, 202, { issue });
  } catch (error) {
    await updateIssue(issue.id, {
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

async function handleUploadInitiateRequest(request, response) {
  if (!isCloudStorageEnabled) {
    writeJson(response, 400, { error: "Direct cloud upload is not configured." });
    return;
  }

  const payload = await readJsonBody(request);
  const uploadMetadata = normalizeUploadMetadata(payload);
  if (uploadMetadata.error) {
    writeJson(response, uploadMetadata.statusCode, { error: uploadMetadata.error });
    return;
  }

  const { issue, originalObjectName } = buildUploadIssue(uploadMetadata);
  const file = bucket().file(originalObjectName);
  const [uploadUrl] = await file.createResumableUpload({
    origin: request.headers.origin || undefined,
    metadata: {
      contentType: uploadMetadata.fileType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  writeJson(response, 200, {
    uploadUrl,
    issue,
  });
}

async function handleUploadCompleteRequest(request, response) {
  const payload = await readJsonBody(request);
  const uploadMetadata = normalizeUploadMetadata(payload);
  if (uploadMetadata.error) {
    writeJson(response, uploadMetadata.statusCode, { error: uploadMetadata.error });
    return;
  }

  const { issue, originalObjectName } = buildUploadIssue(uploadMetadata);
  if (isCloudStorageEnabled) {
    const file = bucket().file(originalObjectName);
    const [exists] = await file.exists();
    if (!exists) {
      writeJson(response, 404, { error: "Uploaded file was not found in storage." });
      return;
    }
  }

  await registerUploadedIssue(issue);
  writeJson(response, 202, { issue });
}

function normalizeUploadMetadata(raw = {}) {
  const issueId = sanitizeSegment(raw.issueId || "");
  const fileName = sanitizeFileName(raw.fileName || "upload.bin");
  const insightType = raw.insightType === "monthly" ? "monthly" : "weekly";
  const issueDate = sanitizeDate(raw.issueDate || "");
  const fileType = raw.fileType || mimeTypes[path.extname(fileName).toLowerCase()] || "application/octet-stream";
  const fileSize = Number(raw.fileSize || 0);
  const isLatest = raw.isLatest === true || raw.isLatest === "true";

  if (!issueId || !fileName || !issueDate) {
    return { error: "Missing issue id, file name, or issue date.", statusCode: 400 };
  }

  const ext = path.extname(fileName).toLowerCase();
  if (![".ppt", ".pptx", ".pdf"].includes(ext)) {
    return { error: "Unsupported file type.", statusCode: 400 };
  }

  return {
    issueId,
    fileName,
    insightType,
    issueDate,
    fileType,
    fileSize,
    isLatest,
  };
}

function buildUploadIssue(uploadMetadata) {
  const uploadDir = path.join(uploadsRoot, uploadMetadata.issueId);
  const originalPath = path.join(uploadDir, uploadMetadata.fileName);
  const originalObjectName = `uploads/${uploadMetadata.issueId}/original/${uploadMetadata.fileName}`;
  const now = new Date().toISOString();
  const originalUrl = isCloudStorageEnabled
    ? storageUrl(originalObjectName)
    : `/data/uploads/${uploadMetadata.issueId}/${encodeURIComponent(uploadMetadata.fileName)}`;

  return {
    uploadDir,
    originalPath,
    originalObjectName,
    issue: {
      id: uploadMetadata.issueId,
      title: generateIssueTitle(uploadMetadata.issueDate, uploadMetadata.insightType),
      insightType: uploadMetadata.insightType,
      issueDate: uploadMetadata.issueDate,
      category: "",
      summary: "",
      tags: [],
      fileName: uploadMetadata.fileName,
      fileType: uploadMetadata.fileType,
      fileSize: uploadMetadata.fileSize,
      originalUrl,
      previewUrl: "",
      pageUrls: [],
      thumbUrls: [],
      conversionJobId: `${uploadMetadata.issueId}-conversion`,
      conversionStatus: "queued",
      conversionMessage: "已上传，等待生成在线预览。",
      conversionProgress: {
        phase: "queued",
        percent: 0,
        processedPages: 0,
        totalPages: 0,
        startedAt: "",
        updatedAt: now,
      },
      status: "processing",
      uploaderId: "local-user",
      publishedAt: "",
      createdAt: now,
      updatedAt: now,
      deletedAt: "",
      isLatest: uploadMetadata.isLatest,
    },
  };
}

async function registerUploadedIssue(issue) {
  await upsertIssue(issue);
  await upsertAsset({
    id: `${issue.id}-original`,
    issueId: issue.id,
    type: "original",
    url: issue.originalUrl,
    pageNumber: null,
    mimeType: issue.fileType,
    size: issue.fileSize,
    createdAt: issue.createdAt,
  });
  await enqueueConversionJob(issue.id);
  enqueueConversion(issue.id);
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

async function handleRetryIssueRequest(url, response) {
  const issueId = sanitizeSegment(url.searchParams.get("issueId") || "");

  if (!issueId) {
    writeJson(response, 400, { error: "Missing issue id." });
    return;
  }

  const db = await readDb();
  const issue = db.issues.find((item) => item.id === issueId && !item.deletedAt);
  if (!issue) {
    writeJson(response, 404, { error: "Issue not found." });
    return;
  }

  await updateIssue(issueId, {
    status: "processing",
    conversionStatus: "queued",
    conversionMessage: "已重新排队生成在线预览。",
    conversionProgress: {
      phase: "queued",
      percent: 0,
      processedPages: 0,
      totalPages: 0,
      startedAt: "",
      updatedAt: new Date().toISOString(),
    },
    pageUrls: [],
    thumbUrls: [],
    updatedAt: new Date().toISOString(),
  });
  await enqueueConversionJob(issueId);
  enqueueConversion(issueId);
  const updatedDb = await readDb();
  const updatedIssue = updatedDb.issues.find((item) => item.id === issueId && !item.deletedAt);
  writeJson(response, 202, { ok: true, issue: updatedIssue });
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
      await failConversionJob(issueId, error.message).catch(() => {});
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
  if (issue.status === "published" && issue.conversionStatus === "ready" && Array.isArray(issue.pageUrls) && issue.pageUrls.length) {
    await completeConversionJob(issueId).catch(() => {});
    return;
  }

  await startConversionJob(issueId);

  const workspace = isCloudStorageEnabled
    ? await fs.promises.mkdtemp(path.join(os.tmpdir(), `insight-convert-${issueId}-`))
    : path.join(uploadsRoot, issueId);
  const uploadDir = workspace;
  const originalPath = path.join(uploadDir, issue.fileName);
  const ext = path.extname(issue.fileName).toLowerCase();
  let previewUrl = ext === ".pdf" ? issue.originalUrl : "";
  let pdfPath = ext === ".pdf" ? originalPath : "";

  if (isCloudStorageEnabled) {
    await fs.promises.mkdir(uploadDir, { recursive: true });
    await downloadStorageObject(`uploads/${issueId}/original/${issue.fileName}`, originalPath);
  }

  if (ext === ".ppt" || ext === ".pptx") {
    const now = new Date().toISOString();
    await updateIssue(issueId, {
      status: "processing",
      conversionStatus: "converting",
      conversionMessage: "正在转换 PPT 为 PDF。",
      conversionProgress: {
        phase: "converting",
        percent: 8,
        processedPages: 0,
        totalPages: 0,
        startedAt: now,
        updatedAt: now,
      },
      updatedAt: now,
    });
    const conversion = await convertPresentationToPdf(originalPath, uploadDir);
    if (conversion.status !== "ready") {
      await failConversionJob(issueId, conversion.message);
      await updateIssue(issueId, {
        status: "failed",
        conversionStatus: conversion.status,
        conversionMessage: conversion.message,
        updatedAt: new Date().toISOString(),
      });
      if (isCloudStorageEnabled) {
        await fs.promises.rm(workspace, { recursive: true, force: true });
      }
      return;
    }
    const convertedName = decodeURIComponent(path.basename(conversion.previewUrl));
    const convertedObjectName = `uploads/${issueId}/preview/${convertedName}`;
    if (isCloudStorageEnabled) {
      await uploadFileToStorage(path.join(uploadDir, convertedName), convertedObjectName, "application/pdf");
      previewUrl = storageUrl(convertedObjectName);
    } else {
      previewUrl = `/data/uploads/${issueId}/${conversion.previewUrl}`;
    }
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

  const totalPages = await getPdfPageCount(pdfPath).catch(() => 0);
  const renderingStartedAt = new Date().toISOString();
  await updateIssue(issueId, {
    status: "processing",
    previewUrl,
    conversionStatus: "rendering",
    conversionMessage: totalPages ? `正在生成高清在线预览：0 / ${totalPages} 页。` : "正在生成高清在线预览。",
    conversionProgress: {
      phase: "rendering",
      percent: ext === ".pdf" ? 5 : 35,
      processedPages: 0,
      totalPages,
      startedAt: renderingStartedAt,
      updatedAt: renderingStartedAt,
    },
    updatedAt: renderingStartedAt,
  });
  const previewAssets = await renderPdfPages(pdfPath, uploadDir, issueId, {
    totalPages,
    basePercent: ext === ".pdf" ? 5 : 35,
    onProgress: async ({ processedPages, totalPages, percent }) => {
      const now = new Date().toISOString();
      await updateIssue(issueId, {
        status: "processing",
        conversionStatus: "rendering",
        conversionMessage: totalPages
          ? `正在生成高清在线预览：${processedPages} / ${totalPages} 页。`
          : "正在生成高清在线预览。",
        conversionProgress: {
          phase: "rendering",
          percent,
          processedPages,
          totalPages,
          startedAt: renderingStartedAt,
          updatedAt: now,
        },
        updatedAt: now,
      });
    },
  });
  const { pageUrls, thumbUrls } = previewAssets;
  const now = new Date().toISOString();
  await updateDb((nextDb) => {
    const nextIssue = nextDb.issues.find((item) => item.id === issueId);
    if (!nextIssue || nextIssue.deletedAt) return;
    nextIssue.previewUrl = previewUrl;
    nextIssue.pageUrls = pageUrls;
    nextIssue.thumbUrls = thumbUrls;
    nextIssue.status = "published";
    nextIssue.conversionStatus = "ready";
    nextIssue.conversionMessage = "发布完成，可在线预览。";
    nextIssue.conversionProgress = {
      phase: "ready",
      percent: 100,
      processedPages: pageUrls.length,
      totalPages: pageUrls.length,
      startedAt: nextIssue.conversionProgress?.startedAt || "",
      updatedAt: now,
    };
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
      upsertAssetInDb(nextDb, {
        id: `${issueId}-thumb-${index + 1}`,
        issueId,
        type: "thumbnail",
        url: thumbUrls[index] || pageUrl,
        pageNumber: index + 1,
        mimeType: "image/png",
        size: 0,
        createdAt: now,
      });
    });
  });
  await completeConversionJob(issueId);

  if (isCloudStorageEnabled) {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
}

async function renderPdfPages(pdfPath, uploadDir, issueId, options = {}) {
  const pagesDir = path.join(uploadDir, "pages");
  const thumbsDir = path.join(uploadDir, "thumbs");
  await fs.promises.rm(pagesDir, { recursive: true, force: true });
  await fs.promises.rm(thumbsDir, { recursive: true, force: true });
  await fs.promises.mkdir(pagesDir, { recursive: true });
  await fs.promises.mkdir(thumbsDir, { recursive: true });
  const totalPages = options.totalPages || await getPdfPageCount(pdfPath).catch(() => 0);

  if (totalPages > 0) {
    const pageUrls = [];
    const thumbUrls = [];
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const outputPrefix = path.join(pagesDir, `page-${String(pageNumber).padStart(2, "0")}`);
      const thumbPrefix = path.join(thumbsDir, `page-${String(pageNumber).padStart(2, "0")}`);
      try {
        await execFileAsync("pdftoppm", [
          "-png",
          "-singlefile",
          "-f",
          String(pageNumber),
          "-l",
          String(pageNumber),
          "-r",
          String(previewDpi),
          pdfPath,
          outputPrefix,
        ], {
          timeout: conversionTimeoutMs,
        });
        await execFileAsync("pdftoppm", [
          "-png",
          "-singlefile",
          "-f",
          String(pageNumber),
          "-l",
          String(pageNumber),
          "-r",
          String(thumbnailDpi),
          pdfPath,
          thumbPrefix,
        ], {
          timeout: conversionTimeoutMs,
        });
      } catch (error) {
        throw enrichCommandError(`PDF 第 ${pageNumber} 页渲染失败`, error);
      }

      const pageFileName = `page-${String(pageNumber).padStart(2, "0")}.png`;
      const pagePath = path.join(pagesDir, pageFileName);
      const thumbPath = path.join(thumbsDir, pageFileName);
      let pageUrl = `/data/uploads/${issueId}/pages/${encodeURIComponent(pageFileName)}`;
      let thumbUrl = `/data/uploads/${issueId}/thumbs/${encodeURIComponent(pageFileName)}`;
      if (isCloudStorageEnabled) {
        const objectName = `uploads/${issueId}/pages/${pageFileName}`;
        const thumbObjectName = `uploads/${issueId}/thumbs/${pageFileName}`;
        await uploadFileToStorage(pagePath, objectName, "image/png");
        await uploadFileToStorage(thumbPath, thumbObjectName, "image/png");
        pageUrl = storageUrl(objectName);
        thumbUrl = storageUrl(thumbObjectName);
      }
      pageUrls.push(pageUrl);
      thumbUrls.push(thumbUrl);

      const pageRatio = pageNumber / totalPages;
      const basePercent = Number(options.basePercent || 0);
      const percent = Math.min(99, Math.round(basePercent + pageRatio * (99 - basePercent)));
      await options.onProgress?.({
        processedPages: pageNumber,
        totalPages,
        percent,
      });
    }
    return { pageUrls, thumbUrls };
  }

  try {
    await execFileAsync("pdftoppm", ["-png", "-r", String(previewDpi), pdfPath, path.join(pagesDir, "page")], {
      timeout: conversionTimeoutMs,
    });
  } catch (error) {
    throw enrichCommandError("PDF 页面渲染失败", error);
  }

  const pageFiles = (await fs.promises.readdir(pagesDir))
    .filter((fileName) => /^page-\d+\.png$/.test(fileName))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));

  if (isCloudStorageEnabled) {
    const pageUrls = [];
    for (const fileName of pageFiles) {
      const objectName = `uploads/${issueId}/pages/${fileName}`;
      await uploadFileToStorage(path.join(pagesDir, fileName), objectName, "image/png");
      pageUrls.push(storageUrl(objectName));
    }
    return { pageUrls, thumbUrls: [...pageUrls] };
  }

  const pageUrls = pageFiles.map((fileName) => `/data/uploads/${issueId}/pages/${encodeURIComponent(fileName)}`);
  return { pageUrls, thumbUrls: [...pageUrls] };
}

async function getPdfPageCount(pdfPath) {
  const { stdout } = await execFileAsync("pdfinfo", [pdfPath], { timeout: 30000 });
  const match = String(stdout).match(/^Pages:\s+(\d+)/m);
  return match ? Number(match[1]) : 0;
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
      timeout: conversionTimeoutMs,
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
      message: enrichCommandError("PPT 转 PDF 失败", error).message,
      previewUrl: "",
    };
  }
}

function enrichCommandError(label, error) {
  const details = [
    label,
    error.killed ? "进程被超时终止。" : "",
    error.signal ? `signal=${error.signal}` : "",
    error.code ? `exitCode=${error.code}` : "",
    error.stderr ? `stderr=${String(error.stderr).trim()}` : "",
    error.stdout ? `stdout=${String(error.stdout).trim()}` : "",
    error.message,
  ].filter(Boolean);
  return new Error(details.join(" "));
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
  if (isCloudStorageEnabled) return;
  await fs.promises.mkdir(dataRoot, { recursive: true });
  await fs.promises.mkdir(uploadsRoot, { recursive: true });
  try {
    await fs.promises.access(dbPath, fs.constants.R_OK);
  } catch {
    await fs.promises.writeFile(dbPath, JSON.stringify({ issues: [], assets: [], jobs: [] }, null, 2));
  }
}

async function readDb() {
  if (isCloudStorageEnabled) {
    const file = bucket().file("db/insight-db.json");
    const [exists] = await file.exists();
    if (!exists) return { issues: [], assets: [], jobs: [] };
    const [raw] = await file.download();
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      return {
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        assets: Array.isArray(parsed.assets) ? parsed.assets : [],
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      };
    } catch {
      return { issues: [], assets: [], jobs: [] };
    }
  }

  await ensureDb();
  const raw = await fs.promises.readFile(dbPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return {
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return { issues: [], assets: [], jobs: [] };
  }
}

async function writeDb(db) {
  if (isCloudStorageEnabled) {
    await bucket().file("db/insight-db.json").save(JSON.stringify({
      issues: sortIssues(db.issues || []),
      assets: db.assets || [],
      jobs: db.jobs || [],
    }, null, 2), {
      contentType: "application/json; charset=utf-8",
      resumable: false,
    });
    return;
  }

  await ensureDb();
  await fs.promises.writeFile(dbPath, JSON.stringify({
    issues: sortIssues(db.issues || []),
    assets: db.assets || [],
    jobs: db.jobs || [],
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

async function enqueueConversionJob(issueId) {
  const now = new Date().toISOString();
  await updateDb((db) => {
    db.jobs = Array.isArray(db.jobs) ? db.jobs : [];
    const jobId = `${issueId}-conversion`;
    const existing = db.jobs.find((job) => job.id === jobId);
    const jobPatch = {
      id: jobId,
      issueId,
      type: "conversion",
      status: "queued",
      lastError: "",
      updatedAt: now,
      completedAt: "",
    };

    if (existing) {
      Object.assign(existing, jobPatch);
      return;
    }

    db.jobs.push({
      ...jobPatch,
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      startedAt: "",
    });
  });
}

async function startConversionJob(issueId) {
  const now = new Date().toISOString();
  await updateDb((db) => {
    db.jobs = Array.isArray(db.jobs) ? db.jobs : [];
    const jobId = `${issueId}-conversion`;
    let job = db.jobs.find((item) => item.id === jobId);
    if (!job) {
      job = {
        id: jobId,
        issueId,
        type: "conversion",
        attempts: 0,
        maxAttempts: 3,
        createdAt: now,
      };
      db.jobs.push(job);
    }
    job.status = "running";
    job.attempts = Number(job.attempts || 0) + 1;
    job.startedAt = now;
    job.updatedAt = now;
    job.completedAt = "";
    job.lastError = "";
  });
}

async function completeConversionJob(issueId) {
  const now = new Date().toISOString();
  await updateDb((db) => {
    const job = (db.jobs || []).find((item) => item.id === `${issueId}-conversion`);
    if (!job) return;
    job.status = "succeeded";
    job.updatedAt = now;
    job.completedAt = now;
    job.lastError = "";
  });
}

async function failConversionJob(issueId, message) {
  const now = new Date().toISOString();
  await updateDb((db) => {
    const job = (db.jobs || []).find((item) => item.id === `${issueId}-conversion`);
    if (!job) return;
    job.status = "failed";
    job.updatedAt = now;
    job.completedAt = now;
    job.lastError = message || "Conversion failed.";
  });
}

async function recoverPendingConversionJobs() {
  const db = await readDb();
  const activeJobs = (db.jobs || []).filter((job) => ["queued", "running"].includes(job.status));
  const activeIssueIds = new Set(
    (db.issues || [])
      .filter((issue) => !issue.deletedAt && (issue.status === "processing" || ["queued", "converting", "rendering"].includes(issue.conversionStatus)))
      .map((issue) => issue.id)
  );

  activeJobs.forEach((job) => {
    if (activeIssueIds.has(job.issueId)) enqueueConversion(job.issueId);
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
    thumbUrls: Array.isArray(rawIssue.thumbUrls) ? rawIssue.thumbUrls : [],
    conversionJobId: rawIssue.conversionJobId || `${id}-conversion`,
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

async function serveStorageObject(url, response) {
  if (!isCloudStorageEnabled) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const objectName = decodeURIComponent(url.pathname.replace(/^\/storage\//, ""));
  if (!objectName || objectName.includes("..")) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const file = bucket().file(objectName);
  const [exists] = await file.exists();
  if (!exists) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const [metadata] = await file.getMetadata();
  response.writeHead(200, {
    "Content-Type": metadata.contentType || mimeTypes[path.extname(objectName)] || "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  file.createReadStream().pipe(response);
}

function bucket() {
  return storage.bucket(gcsBucketName);
}

async function uploadFileToStorage(filePath, objectName, contentType) {
  await bucket().upload(filePath, {
    destination: objectName,
    resumable: false,
    metadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}

async function downloadStorageObject(objectName, filePath) {
  await bucket().file(objectName).download({ destination: filePath });
}

function storageUrl(objectName) {
  return `/storage/${objectName.split("/").map(encodeURIComponent).join("/")}`;
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

function createSession(user, secret) {
  const payload = Buffer.from(JSON.stringify({
    email: user.email,
    role: user.role,
    expiresAt: Date.now() + sessionDurationSeconds * 1000,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function getSessionFromRequest(request) {
  const config = getAuthConfig();
  if (!config.isConfigured) return null;
  const token = parseCookies(request.headers.cookie || "").insight_session;
  if (!token || !token.includes(".")) return null;

  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length) return null;
  const expectedSignature = crypto.createHmac("sha256", config.secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session?.email || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    const user = findUserByEmail(config, session.email);
    return user ? { ...session, email: user.email, role: user.role } : null;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  return String(cookieHeader)
    .split(";")
    .reduce((cookies, part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return cookies;
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (key) cookies[key] = value;
      return cookies;
    }, {});
}

function setSessionCookie(request, response, token) {
  response.setHeader("Set-Cookie", `insight_session=${token}; ${sessionCookieOptions(request)}; Max-Age=${sessionDurationSeconds}`);
}

function clearSessionCookie(request, response) {
  response.setHeader("Set-Cookie", `insight_session=; ${sessionCookieOptions(request)}; Max-Age=0`);
}

function sessionCookieOptions(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const secure = forwardedProto === "https" || process.env.NODE_ENV === "production";
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function getClientAddress(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function registerFailedLogin(address) {
  const existing = loginAttempts.get(address) || { count: 0, blockedUntil: 0 };
  const count = existing.count + 1;
  loginAttempts.set(address, {
    count,
    blockedUntil: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0,
  });
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

ensureDb().then(async () => {
  await recoverPendingConversionJobs();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Insight Hub running at http://0.0.0.0:${port}`);
  });
});

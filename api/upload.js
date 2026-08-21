const path = require("node:path");
const { requireAdminSession } = require("./_lib/auth");
const { uploadBlob, upsertAsset, upsertIssue } = require("./_lib/blob-store");
const {
  generateIssueTitle,
  methodNotAllowed,
  mimeTypes,
  parseUrl,
  readRawBody,
  sanitizeDate,
  sanitizeFileName,
  sanitizeSegment,
  sendJson,
} = require("./_lib/shared");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }
  if (!requireAdminSession(request, response)) return;

  try {
    const url = parseUrl(request);
    const issueId = sanitizeSegment(url.searchParams.get("issueId") || "");
    const fileName = sanitizeFileName(url.searchParams.get("fileName") || "upload.bin");
    const insightType = url.searchParams.get("insightType") === "monthly" ? "monthly" : "weekly";
    const issueDate = sanitizeDate(url.searchParams.get("issueDate") || "");
    const fileType = url.searchParams.get("fileType") || mimeTypes[path.extname(fileName).toLowerCase()] || "application/octet-stream";
    const fileSize = Number(url.searchParams.get("fileSize") || request.headers["content-length"] || 0);
    const isLatest = url.searchParams.get("isLatest") === "true";
    const ext = path.extname(fileName).toLowerCase();

    if (!issueId || !fileName || !issueDate) {
      sendJson(response, 400, { error: "Missing issue id, file name, or issue date." });
      return;
    }

    if (![".ppt", ".pptx", ".pdf"].includes(ext)) {
      sendJson(response, 400, { error: "Unsupported file type." });
      return;
    }

    const body = await readRawBody(request);
    const now = new Date().toISOString();
    const originalPath = `uploads/${issueId}/original/${fileName}`;
    const blob = await uploadBlob(originalPath, body, { contentType: fileType });
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
      fileSize: fileSize || body.length,
      originalUrl: blob.url,
      previewUrl: "",
      pageUrls: [],
      conversionStatus: "queued",
      conversionMessage: "已上传，等待独立转换服务生成在线预览。",
      status: "processing",
      uploaderId: "web-user",
      publishedAt: "",
      createdAt: now,
      updatedAt: now,
      deletedAt: "",
      isLatest,
    };

    await upsertIssue(issue);
    await upsertAsset({
      id: `${issueId}-original`,
      issueId,
      type: "original",
      url: blob.url,
      pageNumber: null,
      mimeType: fileType,
      size: fileSize || body.length,
      createdAt: now,
    });

    sendJson(response, 202, { issue });
  } catch (error) {
    sendJson(response, 500, { error: "Upload failed.", message: error.message });
  }
};

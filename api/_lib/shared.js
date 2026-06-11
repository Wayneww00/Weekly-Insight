const path = require("node:path");

const mimeTypes = {
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
};

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function methodNotAllowed(response) {
  sendJson(response, 405, { error: "Method not allowed." });
}

function parseUrl(request) {
  return new URL(request.url || "/", "https://weekly-insight.local");
}

function sanitizeSegment(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeFileName(value) {
  return path.basename(String(value || "upload.bin")).replace(/[^\w.\- ()\u4e00-\u9fa5]/g, "_");
}

function sanitizeDate(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function sortIssues(issues) {
  return [...issues].sort((a, b) => {
    if ((a.issueDate || "") === (b.issueDate || "")) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    }
    return String(b.issueDate || "").localeCompare(String(a.issueDate || ""));
  });
}

function generateIssueTitle(issueDate, insightType) {
  if (!issueDate) return insightType === "weekly" ? "Weekly Insights" : "Monthly Insights";
  if (insightType === "monthly") return `${issueDate.slice(0, 7)} Monthly Insights`;
  return `${issueDate} Weekly Insights`;
}

function normalizeIssue(rawIssue) {
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
    uploaderId: rawIssue.uploaderId || "web-user",
    publishedAt: rawIssue.publishedAt || "",
    createdAt: rawIssue.createdAt || new Date().toISOString(),
    updatedAt: rawIssue.updatedAt || rawIssue.createdAt || new Date().toISOString(),
    deletedAt: rawIssue.deletedAt || "",
    isLatest: Boolean(rawIssue.isLatest),
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function requireWorkerSecret(request, response) {
  const expected = process.env.WORKER_SECRET;
  if (!expected) {
    sendJson(response, 500, { error: "WORKER_SECRET is not configured." });
    return false;
  }
  const actual = request.headers["x-worker-secret"] || request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (actual !== expected) {
    sendJson(response, 401, { error: "Unauthorized worker request." });
    return false;
  }
  return true;
}

module.exports = {
  generateIssueTitle,
  methodNotAllowed,
  mimeTypes,
  normalizeIssue,
  parseUrl,
  readJsonBody,
  readRawBody,
  requireWorkerSecret,
  sanitizeDate,
  sanitizeFileName,
  sanitizeSegment,
  sendJson,
  sortIssues,
};

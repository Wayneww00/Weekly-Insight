const { updateDb, upsertAssetInDb } = require("../_lib/blob-store");
const { methodNotAllowed, readJsonBody, requireWorkerSecret, sanitizeSegment, sendJson } = require("../_lib/shared");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }

  if (!requireWorkerSecret(request, response)) return;

  try {
    const payload = await readJsonBody(request);
    const issueId = sanitizeSegment(payload.issueId || "");
    if (!issueId) {
      sendJson(response, 400, { error: "Missing issue id." });
      return;
    }

    const now = new Date().toISOString();
    const failed = payload.status === "failed";
    await updateDb((db) => {
      const issue = db.issues.find((item) => item.id === issueId);
      if (!issue || issue.deletedAt) return;

      if (failed) {
        issue.status = "failed";
        issue.conversionStatus = "failed";
        issue.conversionMessage = payload.conversionMessage || "预览生成失败。";
        issue.updatedAt = now;
        return;
      }

      issue.previewUrl = payload.previewUrl || issue.previewUrl || "";
      issue.pageUrls = Array.isArray(payload.pageUrls) ? payload.pageUrls : [];
      issue.status = "published";
      issue.conversionStatus = "ready";
      issue.conversionMessage = "发布完成，可在线预览。";
      issue.publishedAt = issue.publishedAt || now;
      issue.updatedAt = now;

      if (payload.previewUrl) {
        upsertAssetInDb(db, {
          id: `${issueId}-pdf`,
          issueId,
          type: "pdf",
          url: payload.previewUrl,
          pageNumber: null,
          mimeType: "application/pdf",
          size: 0,
          createdAt: now,
        });
      }

      issue.pageUrls.forEach((pageUrl, index) => {
        upsertAssetInDb(db, {
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

    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, 500, { error: "Completion update failed.", message: error.message });
  }
};

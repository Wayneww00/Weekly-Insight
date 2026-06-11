const { updateIssue } = require("../_lib/blob-store");
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
    await updateIssue(issueId, {
      status: payload.status || "processing",
      conversionStatus: payload.conversionStatus || "converting",
      conversionMessage: payload.conversionMessage || "正在处理文件。",
      updatedAt: now,
    });

    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, 500, { error: "Status update failed.", message: error.message });
  }
};

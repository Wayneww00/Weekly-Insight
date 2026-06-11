const { readDb, updateIssue } = require("../_lib/blob-store");
const { methodNotAllowed, requireWorkerSecret, sendJson, sortIssues } = require("../_lib/shared");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }

  if (!requireWorkerSecret(request, response)) return;

  const db = await readDb();
  const issue = sortIssues(db.issues).find((item) => !item.deletedAt && item.status === "processing" && item.conversionStatus === "queued");

  if (!issue) {
    sendJson(response, 200, { issue: null });
    return;
  }

  const now = new Date().toISOString();
  await updateIssue(issue.id, {
    conversionStatus: "converting",
    conversionMessage: "正在转换文件格式。",
    workerClaimedAt: now,
    updatedAt: now,
  });

  sendJson(response, 200, {
    issue: {
      ...issue,
      conversionStatus: "converting",
      conversionMessage: "正在转换文件格式。",
      workerClaimedAt: now,
      updatedAt: now,
    },
  });
};

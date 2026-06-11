const { readDb, updateDb } = require("./_lib/blob-store");
const { methodNotAllowed, parseUrl, sanitizeSegment, sendJson, sortIssues } = require("./_lib/shared");

module.exports = async function handler(request, response) {
  if (request.method === "GET") {
    await getIssue(request, response);
    return;
  }

  if (request.method === "DELETE") {
    await deleteIssue(request, response);
    return;
  }

  methodNotAllowed(response);
};

async function getIssue(request, response) {
  const url = parseUrl(request);
  const issueId = sanitizeSegment(url.searchParams.get("issueId") || "");
  const db = await readDb();
  const issue = db.issues.find((item) => item.id === issueId && !item.deletedAt);

  if (!issue) {
    sendJson(response, 404, { error: "Issue not found." });
    return;
  }

  sendJson(response, 200, { issue });
}

async function deleteIssue(request, response) {
  const url = parseUrl(request);
  const issueId = sanitizeSegment(url.searchParams.get("issueId") || "");

  if (!issueId) {
    sendJson(response, 400, { error: "Missing issue id." });
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

  sendJson(response, 200, { ok: true });
}

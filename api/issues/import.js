const { updateDb, upsertIssueInDb } = require("../_lib/blob-store");
const { methodNotAllowed, normalizeIssue, readJsonBody, sendJson } = require("../_lib/shared");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const incomingIssues = Array.isArray(payload.issues) ? payload.issues : [];
    const importedIds = [];

    await updateDb((db) => {
      incomingIssues.forEach((rawIssue) => {
        const issue = normalizeIssue(rawIssue);
        if (!issue || db.issues.some((item) => item.id === issue.id)) return;
        upsertIssueInDb(db, issue);
        importedIds.push(issue.id);
      });
    });

    sendJson(response, 200, { importedIds });
  } catch (error) {
    sendJson(response, 500, { error: "Import failed.", message: error.message });
  }
};

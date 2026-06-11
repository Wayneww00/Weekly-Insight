const { readDb } = require("./_lib/blob-store");
const { methodNotAllowed, sendJson, sortIssues } = require("./_lib/shared");

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    methodNotAllowed(response);
    return;
  }

  try {
    const db = await readDb();
    sendJson(response, 200, {
      issues: sortIssues(db.issues.filter((issue) => !issue.deletedAt)),
    });
  } catch (error) {
    sendJson(response, 500, { error: "Unable to load issues.", message: error.message });
  }
};

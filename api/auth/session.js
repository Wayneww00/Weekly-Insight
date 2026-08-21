const { getSession } = require("../_lib/auth");
const { methodNotAllowed, sendJson } = require("../_lib/shared");

module.exports = async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response);
  const session = getSession(request);
  if (!session) return sendJson(response, 401, { error: "未登录。" });
  sendJson(response, 200, { user: { email: session.email, role: session.role } });
};

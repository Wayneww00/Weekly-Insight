const { clearSessionCookie } = require("../_lib/auth");
const { methodNotAllowed, sendJson } = require("../_lib/shared");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response);
  clearSessionCookie(request, response);
  sendJson(response, 200, { ok: true });
};

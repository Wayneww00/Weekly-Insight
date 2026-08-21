const { authenticateUser } = require("../../auth-config");
const { createSession, getAuthConfig, setSessionCookie } = require("../_lib/auth");
const { methodNotAllowed, readJsonBody, sendJson } = require("../_lib/shared");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response);
  const config = getAuthConfig();
  if (!config.isConfigured) return sendJson(response, 503, { error: "登录服务尚未配置。" });

  try {
    const payload = await readJsonBody(request);
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const user = authenticateUser(config, email, password);
    if (!user) {
      return sendJson(response, 401, { error: "邮箱或密码不正确。" });
    }
    setSessionCookie(request, response, createSession(user, config.secret));
    sendJson(response, 200, { user });
  } catch {
    sendJson(response, 400, { error: "登录请求无效。" });
  }
};

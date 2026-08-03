const { createSession, getAuthConfig, safeEqual, setSessionCookie } = require("../_lib/auth");
const { methodNotAllowed, readJsonBody, sendJson } = require("../_lib/shared");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response);
  const config = getAuthConfig();
  if (!config.isConfigured) return sendJson(response, 503, { error: "登录服务尚未配置。" });

  try {
    const payload = await readJsonBody(request);
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    if (!safeEqual(email, config.email.toLowerCase()) || !safeEqual(password, config.password)) {
      return sendJson(response, 401, { error: "邮箱或密码不正确。" });
    }
    setSessionCookie(request, response, createSession(config.email, config.secret));
    sendJson(response, 200, { user: { email: config.email, role: "admin" } });
  } catch {
    sendJson(response, 400, { error: "登录请求无效。" });
  }
};

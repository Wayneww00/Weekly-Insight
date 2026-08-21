const crypto = require("node:crypto");
const { findUserByEmail, getAuthConfig, safeEqual } = require("../../auth-config");
const { sendJson } = require("./shared");

const sessionDurationSeconds = 60 * 60 * 24 * 7;

function getSession(request) {
  const config = getAuthConfig();
  if (!config.isConfigured) return null;
  const token = parseCookies(request.headers.cookie || "").insight_session;
  if (!token) return null;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length) return null;
  const expected = crypto.createHmac("sha256", config.secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session?.email || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    const user = findUserByEmail(config, session.email);
    return user ? { ...session, email: user.email, role: user.role } : null;
  } catch {
    return null;
  }
}

function requireSession(request, response) {
  const session = getSession(request);
  if (session) return session;
  sendJson(response, 401, { error: "请先登录。" });
  return null;
}

function requireAdminSession(request, response) {
  const session = requireSession(request, response);
  if (!session) return null;
  if (session.role === "admin") return session;
  sendJson(response, 403, { error: "当前账号没有内容管理权限。" });
  return null;
}

function createSession(user, secret) {
  const payload = Buffer.from(JSON.stringify({
    email: user.email,
    role: user.role,
    expiresAt: Date.now() + sessionDurationSeconds * 1000,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function setSessionCookie(request, response, token) {
  response.setHeader("Set-Cookie", `insight_session=${token}; ${sessionCookieOptions(request)}; Max-Age=${sessionDurationSeconds}`);
}

function clearSessionCookie(request, response) {
  response.setHeader("Set-Cookie", `insight_session=; ${sessionCookieOptions(request)}; Max-Age=0`);
}

function sessionCookieOptions(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const secure = forwardedProto === "https" || process.env.NODE_ENV === "production";
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function parseCookies(header) {
  return String(header).split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    if (key) cookies[key] = part.slice(separator + 1).trim();
    return cookies;
  }, {});
}

module.exports = {
  clearSessionCookie,
  createSession,
  getAuthConfig,
  getSession,
  requireAdminSession,
  requireSession,
  safeEqual,
  setSessionCookie,
};

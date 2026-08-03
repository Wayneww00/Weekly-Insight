const crypto = require("node:crypto");
const { sendJson } = require("./shared");

const sessionDurationSeconds = 60 * 60 * 24 * 7;

function getAuthConfig() {
  const email = process.env.INSIGHT_AUTH_EMAIL || "admin@vtg.bot";
  const password = process.env.INSIGHT_AUTH_PASSWORD || "";
  const secret = process.env.SESSION_SECRET || "";
  return { email, password, secret, isConfigured: Boolean(password && secret.length >= 32) };
}

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
    return safeEqual(String(session.email).toLowerCase(), config.email.toLowerCase()) ? session : null;
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

function createSession(email, secret) {
  const payload = Buffer.from(JSON.stringify({ email, expiresAt: Date.now() + sessionDurationSeconds * 1000 })).toString("base64url");
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

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  clearSessionCookie,
  createSession,
  getAuthConfig,
  getSession,
  requireSession,
  safeEqual,
  setSessionCookie,
};

const crypto = require("node:crypto");
const bundledCredentialStore = require("./config/auth-users.json");

const defaultAdminEmail = "admin@vtg.com";
const defaultAdminPassword = "admin123456";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value) {
  return value === "admin" ? "admin" : "reader";
}

function getAuthConfig() {
  const secret = process.env.SESSION_SECRET || "";
  const userMap = new Map();

  for (const rawUser of bundledCredentialStore.users || []) {
    addUser(userMap, rawUser);
  }

  addUser(userMap, {
    email: process.env.INSIGHT_AUTH_EMAIL || defaultAdminEmail,
    password: process.env.INSIGHT_AUTH_PASSWORD || defaultAdminPassword,
    role: "admin",
  });

  for (const rawUser of parseEnvironmentUsers(process.env.INSIGHT_AUTH_USERS_JSON)) {
    addUser(userMap, rawUser);
  }

  return {
    secret,
    users: [...userMap.values()],
    userMap,
    isConfigured: Boolean(secret.length >= 32 && userMap.size),
  };
}

function parseEnvironmentUsers(rawValue) {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addUser(userMap, rawUser) {
  const email = normalizeEmail(rawUser?.email);
  if (!email || (!rawUser?.password && !rawUser?.passwordHash)) return;
  userMap.set(email, {
    email,
    role: normalizeRole(rawUser.role),
    password: rawUser.password ? String(rawUser.password) : "",
    passwordHash: rawUser.passwordHash ? String(rawUser.passwordHash) : "",
  });
}

function findUserByEmail(config, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  if (config?.userMap instanceof Map) return config.userMap.get(normalizedEmail) || null;
  return (config?.users || []).find((user) => user.email === normalizedEmail) || null;
}

function authenticateUser(config, email, password) {
  const user = findUserByEmail(config, email);
  if (!user || !verifyPassword(user, password)) return null;
  return { email: user.email, role: user.role };
}

function verifyPassword(user, password) {
  if (user.passwordHash) return verifyScryptHash(password, user.passwordHash);
  return safeEqual(password, user.password || "");
}

function verifyScryptHash(password, encodedHash) {
  const [algorithm, cost, blockSize, parallelization, encodedSalt, encodedDigest, ...rest] = String(encodedHash).split("$");
  if (algorithm !== "scrypt" || !cost || !blockSize || !parallelization || !encodedSalt || !encodedDigest || rest.length) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedDigest, "base64url");
    const actual = crypto.scryptSync(String(password || ""), salt, expected.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelization),
      maxmem: 64 * 1024 * 1024,
    });
    return safeEqualBuffers(actual, expected);
  } catch {
    return false;
  }
}

function safeEqual(left, right) {
  return safeEqualBuffers(Buffer.from(String(left)), Buffer.from(String(right)));
}

function safeEqualBuffers(leftBuffer, rightBuffer) {
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  authenticateUser,
  findUserByEmail,
  getAuthConfig,
  normalizeEmail,
  safeEqual,
  verifyPassword,
};

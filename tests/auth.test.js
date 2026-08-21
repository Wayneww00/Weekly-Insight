const assert = require("node:assert/strict");
const test = require("node:test");

const bundledCredentialStore = require("../config/auth-users.json");
const { authenticateUser, getAuthConfig } = require("../auth-config");

test("bundled reader account store contains 71 unique hashed accounts", () => {
  const users = bundledCredentialStore.users || [];
  const emails = users.map((user) => user.email);

  assert.equal(users.length, 71);
  assert.equal(new Set(emails).size, 71);
  assert.equal(users.every((user) => user.role === "reader"), true);
  assert.equal(users.every((user) => /^scrypt\$16384\$8\$1\$/.test(user.passwordHash || "")), true);
  assert.equal(users.every((user) => !Object.hasOwn(user, "password")), true);
});

test("Lyn account authenticates case-insensitively as a reader", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-secret-that-is-longer-than-32-characters";
  try {
    const config = getAuthConfig();
    assert.deepEqual(authenticateUser(config, "Lyn@vtg.com", "Lyn123456"), {
      email: "lyn@vtg.com",
      role: "reader",
    });
    assert.equal(authenticateUser(config, "Lyn@vtg.com", "wrong-password"), null);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("legacy administrator remains available alongside bundled readers", () => {
  const previous = {
    email: process.env.INSIGHT_AUTH_EMAIL,
    password: process.env.INSIGHT_AUTH_PASSWORD,
    secret: process.env.SESSION_SECRET,
  };
  process.env.INSIGHT_AUTH_EMAIL = "admin@vtg.com";
  process.env.INSIGHT_AUTH_PASSWORD = "admin123456";
  process.env.SESSION_SECRET = "test-secret-that-is-longer-than-32-characters";

  try {
    const config = getAuthConfig();
    assert.equal(config.users.length, 72);
    assert.deepEqual(authenticateUser(config, "admin@vtg.com", "admin123456"), {
      email: "admin@vtg.com",
      role: "admin",
    });
  } finally {
    for (const [key, value] of Object.entries({
      INSIGHT_AUTH_EMAIL: previous.email,
      INSIGHT_AUTH_PASSWORD: previous.password,
      SESSION_SECRET: previous.secret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

const { sortIssues } = require("./shared");

const DB_KEY = "db/insight-db.json";
let writeQueue = Promise.resolve();

async function blobClient() {
  return import("@vercel/blob");
}

function defaultDb() {
  return { issues: [], assets: [] };
}

async function readDb() {
  const { list } = await blobClient();
  const result = await list({ prefix: DB_KEY, limit: 1 });
  const dbBlob = result.blobs.find((blob) => blob.pathname === DB_KEY);
  if (!dbBlob) return defaultDb();

  const response = await fetch(`${dbBlob.url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return defaultDb();
  const parsed = await response.json().catch(() => defaultDb());
  return {
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    assets: Array.isArray(parsed.assets) ? parsed.assets : [],
  };
}

async function writeDb(db) {
  const { put } = await blobClient();
  await put(DB_KEY, JSON.stringify({
    issues: sortIssues(db.issues || []),
    assets: db.assets || [],
  }, null, 2), {
    access: "public",
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
  });
}

async function updateDb(mutator) {
  writeQueue = writeQueue.then(async () => {
    const db = await readDb();
    await mutator(db);
    await writeDb(db);
    return db;
  });
  return writeQueue;
}

function upsertIssueInDb(db, issue) {
  const existingIndex = db.issues.findIndex((item) => item.id === issue.id);
  if (existingIndex >= 0) {
    db.issues[existingIndex] = { ...db.issues[existingIndex], ...issue };
  } else {
    db.issues.push(issue);
  }
  db.issues = sortIssues(db.issues);
}

async function upsertIssue(issue) {
  return updateDb((db) => {
    if (issue.isLatest) {
      db.issues.forEach((item) => {
        if (!item.deletedAt) item.isLatest = false;
      });
    }
    upsertIssueInDb(db, issue);
  });
}

async function updateIssue(issueId, patch) {
  return updateDb((db) => {
    const issue = db.issues.find((item) => item.id === issueId);
    if (!issue) return;
    Object.assign(issue, patch);
  });
}

function upsertAssetInDb(db, asset) {
  const existingIndex = db.assets.findIndex((item) => item.id === asset.id);
  if (existingIndex >= 0) {
    db.assets[existingIndex] = { ...db.assets[existingIndex], ...asset };
  } else {
    db.assets.push(asset);
  }
}

async function upsertAsset(asset) {
  return updateDb((db) => upsertAssetInDb(db, asset));
}

async function uploadBlob(pathname, body, options = {}) {
  const { put } = await blobClient();
  return put(pathname, body, {
    access: "public",
    allowOverwrite: true,
    ...options,
  });
}

module.exports = {
  readDb,
  updateDb,
  updateIssue,
  uploadBlob,
  upsertAsset,
  upsertAssetInDb,
  upsertIssue,
  upsertIssueInDb,
};

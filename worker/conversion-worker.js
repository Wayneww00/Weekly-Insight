const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const appBaseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
const workerSecret = process.env.WORKER_SECRET || "";
const previewDpi = Number(process.env.PREVIEW_DPI || 300);
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 5000);

if (!appBaseUrl || !workerSecret || !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Missing APP_BASE_URL, WORKER_SECRET, or BLOB_READ_WRITE_TOKEN.");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  console.log(`Conversion worker started for ${appBaseUrl}`);
  while (true) {
    const issue = await claimIssue();
    if (!issue) {
      await sleep(pollIntervalMs);
      continue;
    }

    try {
      await processIssue(issue);
    } catch (error) {
      console.error(`Issue ${issue.id} failed:`, error);
      await completeIssue({
        issueId: issue.id,
        status: "failed",
        conversionMessage: error.message,
      });
    }
  }
}

async function claimIssue() {
  const response = await fetch(`${appBaseUrl}/api/worker/claim`, {
    method: "POST",
    headers: { "x-worker-secret": workerSecret },
  });
  if (!response.ok) throw new Error(`Claim failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return payload.issue || null;
}

async function processIssue(issue) {
  const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), `insight-${issue.id}-`));
  try {
    await updateStatus(issue.id, "converting", "正在下载原文件。");
    const originalPath = path.join(workspace, issue.fileName);
    await downloadFile(issue.originalUrl, originalPath);

    const ext = path.extname(issue.fileName).toLowerCase();
    let pdfPath = originalPath;
    let previewUrl = issue.originalUrl;

    if (ext === ".ppt" || ext === ".pptx") {
      await updateStatus(issue.id, "converting", "正在转换 PPT 为 PDF。");
      pdfPath = await convertPresentationToPdf(originalPath, workspace);
      previewUrl = await uploadWorkerBlob(
        `uploads/${issue.id}/preview/${path.basename(pdfPath)}`,
        await fs.promises.readFile(pdfPath),
        "application/pdf"
      );
    }

    await updateStatus(issue.id, "rendering", "正在生成高清在线预览。");
    const pagePaths = await renderPdfPages(pdfPath, path.join(workspace, "pages"));
    const pageUrls = [];
    for (const pagePath of pagePaths) {
      const pageUrl = await uploadWorkerBlob(
        `uploads/${issue.id}/pages/${path.basename(pagePath)}`,
        await fs.promises.readFile(pagePath),
        "image/png"
      );
      pageUrls.push(pageUrl);
    }

    await completeIssue({
      issueId: issue.id,
      status: "published",
      previewUrl,
      pageUrls,
    });
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(targetPath, buffer);
}

async function convertPresentationToPdf(originalPath, outputDir) {
  const soffice = await findSoffice();
  if (!soffice) {
    throw new Error("未检测到 LibreOffice，无法把 PPT/PPTX 转成 PDF 预览。");
  }

  await execFileAsync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", outputDir, originalPath], {
    timeout: 300000,
  });
  const convertedPath = path.join(outputDir, `${path.basename(originalPath, path.extname(originalPath))}.pdf`);
  await fs.promises.access(convertedPath, fs.constants.R_OK);
  return convertedPath;
}

async function renderPdfPages(pdfPath, outputDir) {
  await fs.promises.mkdir(outputDir, { recursive: true });
  await execFileAsync("pdftoppm", ["-png", "-r", String(previewDpi), pdfPath, path.join(outputDir, "page")], {
    timeout: 300000,
  });

  return (await fs.promises.readdir(outputDir))
    .filter((fileName) => /^page-\d+\.png$/.test(fileName))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
    .map((fileName) => path.join(outputDir, fileName));
}

async function uploadWorkerBlob(pathname, body, contentType) {
  const { put } = await import("@vercel/blob");
  const blob = await put(pathname, body, {
    access: "public",
    allowOverwrite: true,
    contentType,
  });
  return blob.url;
}

async function updateStatus(issueId, conversionStatus, conversionMessage) {
  const response = await fetch(`${appBaseUrl}/api/worker/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": workerSecret,
    },
    body: JSON.stringify({
      issueId,
      status: "processing",
      conversionStatus,
      conversionMessage,
    }),
  });
  if (!response.ok) throw new Error(`Status update failed: ${response.status} ${await response.text()}`);
}

async function completeIssue(payload) {
  const response = await fetch(`${appBaseUrl}/api/worker/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": workerSecret,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Completion update failed: ${response.status} ${await response.text()}`);
}

async function findSoffice() {
  const candidates = [
    process.env.SOFFICE_PATH,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "soffice",
    "libreoffice",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 5000 });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

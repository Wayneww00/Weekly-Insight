const http = require("node:http");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const uploadsRoot = path.join(root, "data", "uploads");
const previewDpi = Number(process.env.PREVIEW_DPI || 300);
const execFileAsync = promisify(execFile);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url?.startsWith("/api/upload")) {
    await handleUploadRequest(request, response);
    return;
  }

  if (request.method === "DELETE" && request.url?.startsWith("/api/issue")) {
    await handleDeleteIssueRequest(request, response);
    return;
  }

  const requestPath = decodeURIComponent(new URL(request.url || "/", `http://localhost:${port}`).pathname);
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
});

async function handleUploadRequest(request, response) {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  const issueId = sanitizeSegment(url.searchParams.get("issueId") || "");
  const rawFileName = url.searchParams.get("fileName") || "upload.bin";
  const fileName = sanitizeFileName(rawFileName);

  if (!issueId || !fileName) {
    writeJson(response, 400, { error: "Missing issue id or file name." });
    return;
  }

  const uploadDir = path.join(uploadsRoot, issueId);
  const originalPath = path.join(uploadDir, fileName);
  const ext = path.extname(fileName).toLowerCase();

  try {
    await fs.promises.mkdir(uploadDir, { recursive: true });
    await writeRequestBody(request, originalPath);

    const originalUrl = `/data/uploads/${issueId}/${encodeURIComponent(fileName)}`;
    const result = {
      originalUrl,
      previewUrl: ext === ".pdf" ? originalUrl : "",
      pageUrls: [],
      conversionStatus: ext === ".pdf" ? "ready" : "pending",
      conversionMessage: ext === ".pdf" ? "PDF can be previewed directly." : "Waiting for PPT conversion.",
    };

    if (ext === ".ppt" || ext === ".pptx") {
      const conversion = await convertPresentationToPdf(originalPath, uploadDir);
      result.previewUrl = conversion.previewUrl ? `/data/uploads/${issueId}/${conversion.previewUrl}` : "";
      result.conversionStatus = conversion.status;
      result.conversionMessage = conversion.message;
    }

    if (result.previewUrl) {
      const pdfPath = ext === ".pdf"
        ? originalPath
        : path.join(uploadDir, decodeURIComponent(path.basename(result.previewUrl)));
      result.pageUrls = await renderPdfPages(pdfPath, uploadDir, issueId);
    }

    writeJson(response, 200, result);
  } catch (error) {
    writeJson(response, 500, {
      error: "Upload failed.",
      conversionStatus: "failed",
      conversionMessage: error.message,
    });
  }
}

async function handleDeleteIssueRequest(request, response) {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  const issueId = sanitizeSegment(url.searchParams.get("issueId") || "");

  if (!issueId) {
    writeJson(response, 400, { error: "Missing issue id." });
    return;
  }

  try {
    await fs.promises.rm(path.join(uploadsRoot, issueId), { recursive: true, force: true });
    writeJson(response, 200, { ok: true });
  } catch (error) {
    writeJson(response, 500, { error: "Delete failed.", message: error.message });
  }
}

async function renderPdfPages(pdfPath, uploadDir, issueId) {
  const pagesDir = path.join(uploadDir, "pages");
  await fs.promises.rm(pagesDir, { recursive: true, force: true });
  await fs.promises.mkdir(pagesDir, { recursive: true });

  await execFileAsync("pdftoppm", ["-png", "-r", String(previewDpi), pdfPath, path.join(pagesDir, "page")], {
    timeout: 300000,
  });

  const pageFiles = (await fs.promises.readdir(pagesDir))
    .filter((fileName) => /^page-\d+\.png$/.test(fileName))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));

  return pageFiles.map((fileName) => `/data/uploads/${issueId}/pages/${encodeURIComponent(fileName)}`);
}

function writeRequestBody(request, filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    request.pipe(stream);
    request.on("error", reject);
    stream.on("error", reject);
    stream.on("finish", resolve);
  });
}

async function convertPresentationToPdf(originalPath, uploadDir) {
  const soffice = await findSoffice();
  if (!soffice) {
    return {
      status: "failed",
      message: "未检测到 LibreOffice，无法把 PPT/PPTX 转成 PDF 预览。请安装 LibreOffice 后重新上传。",
      previewUrl: "",
    };
  }

  try {
    await execFileAsync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", uploadDir, originalPath], {
      timeout: 120000,
    });
    const convertedName = `${path.basename(originalPath, path.extname(originalPath))}.pdf`;
    const convertedPath = path.join(uploadDir, convertedName);
    await fs.promises.access(convertedPath, fs.constants.R_OK);
    return {
      status: "ready",
      message: "PPT 已转换为 PDF，可在线预览。",
      previewUrl: encodeURIComponent(convertedName),
    };
  } catch (error) {
    return {
      status: "failed",
      message: `PPT 转换失败：${error.message}`,
      previewUrl: "",
    };
  }
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

function sanitizeSegment(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeFileName(value) {
  return path.basename(value).replace(/[^\w.\- ()\u4e00-\u9fff]/g, "_");
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Insight Hub running at http://127.0.0.1:${port}`);
});

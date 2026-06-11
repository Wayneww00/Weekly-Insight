const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

copyFile("index.html");
copyDirectory("src");
copyDirectory("assets");

function copyFile(relativePath) {
  fs.copyFileSync(path.join(root, relativePath), path.join(dist, relativePath));
}

function copyDirectory(relativePath) {
  fs.cpSync(path.join(root, relativePath), path.join(dist, relativePath), {
    recursive: true,
  });
}

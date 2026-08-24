const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");

const BIN_DIR = path.join(__dirname, "..", "bin");
const DOWNLOAD_URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(download(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} while downloading yt-dlp`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  if (process.platform === "win32") return;
  await fsp.mkdir(BIN_DIR, { recursive: true });
  const dest = path.join(BIN_DIR, "yt-dlp");
  const buf = await download(DOWNLOAD_URL);
  await fsp.writeFile(dest, buf);
  await fsp.chmod(dest, 0o755);
  console.log(`yt-dlp installed -> ${dest} (${(buf.length / 1048576).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.warn("yt-dlp download failed:", err.message);
  process.exit(1);
});

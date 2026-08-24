const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PUBLIC_ASSETS = ["style.css", "script.js"];
PUBLIC_ASSETS.forEach((file) => {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
});
app.use("/logo", express.static(path.join(__dirname, "logo")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

function resolveYtDlp() {
  const bundled = path.join(__dirname, "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(bundled)) return bundled;
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return process.env.YTDLP_PATH;
  }
  const candidates = [];
  if (process.platform === "win32" && process.env.APPDATA) {
    const pythonDir = path.join(process.env.APPDATA, "Python");
    try {
      for (const entry of fs.readdirSync(pythonDir)) {
        candidates.push(path.join(pythonDir, entry, "Scripts", "yt-dlp.exe"));
      }
    } catch {}
  }
  return candidates.find((c) => fs.existsSync(c)) || "yt-dlp";
}

const YTDLP = resolveYtDlp();
const FFMPEG_DIR = path.join(__dirname, "node_modules", "ffmpeg-static");
const JOBS_ROOT = path.join(os.tmpdir(), "godown-jobs");

const MEDIA_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "m.youtube.com",
  "music.youtube.com",
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "v.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
  "instagr.am"
]);

const jobs = new Map();

function isValidUrl(str) {
  try {
    return MEDIA_HOSTS.has(new URL(str).hostname);
  } catch {
    return false;
  }
}

function baseArgs() {
  const args = ["--js-runtimes", "node", "--no-playlist", "--no-warnings", "--ffmpeg-location", FFMPEG_DIR];

  if (process.env.YTDLP_COOKIES_FILE) {
    args.push("--cookies", process.env.YTDLP_COOKIES_FILE);
  } else if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
    args.push("--cookies-from-browser", process.env.YTDLP_COOKIES_FROM_BROWSER);
  }

  return args;
}

function runYtDlpJson(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [...baseArgs(), "-J", url], { windowsHide: true });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => proc.kill(), 60000);
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(err.split("\n").filter(Boolean).pop() || "Could not fetch video info."));
      }
    });
  });
}

app.get("/api/info", async (req, res) => {
  const url = req.query.url;
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: "Please provide a valid YouTube URL." });
  }
  try {
    const d = await runYtDlpJson(url);

    const heights = [
      ...new Set(
        d.formats
          .filter((f) => f.height && (f.vcodec !== "none"))
          .map((f) => f.height)
      )
    ].sort((a, b) => b - a);

    const audioBitrate = Math.max(
      0,
      ...d.formats.filter((f) => f.acodec && f.acodec !== "none").map((f) => f.abr || 0)
    );

    res.json({
      id: d.id,
      title: d.title,
      author: d.uploader || d.channel,
      lengthSec: Math.round(d.duration || 0),
      views: d.view_count,
      thumbnail: d.thumbnail,
      heights,
      hasAudio: !!d.formats.some((f) => f.acodec && f.acodec !== "none"),
      live: !!d.is_live
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

function safeName(title) {
  return (
    title
      .replace(/[\\/:*?"<>|]+/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 70) || "download"
  );
}

app.post("/api/jobs", async (req, res) => {
  const { url, type = "mp4", height, title } = req.body || {};
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: "Please provide a valid YouTube URL." });
  }

  const dir = path.join(JOBS_ROOT, crypto.randomUUID());
  await fsp.mkdir(dir, { recursive: true });

  const ext = type === "mp3" ? "mp3" : "mp4";
  const label = type === "mp3" ? "" : `_${parseInt(height, 10) || 720}p`;
  const args = [
    ...baseArgs(),
    "-o", path.join(dir, `dl.${ext}`),
    "--newline",
    "--concurrent-fragments", "4"
  ];

  if (type === "mp3") {
    args.push("-f", "ba", "-x", "--audio-format", "mp3", "--audio-quality", "192K");
  } else {
    const h = parseInt(height, 10) || 720;
    args.push(
      "-f", "bv*+ba/b",
      "-S", `res:${h},vcodec:h264,acodec:aac`,
      "--merge-output-format", "mp4"
    );
  }

  const id = path.basename(dir);
  const job = { id, state: "downloading", pct: 0, error: null, title, label, created: Date.now() };
  jobs.set(id, job);

  const proc = spawn(YTDLP, [...args, url], { windowsHide: true });
  job.proc = proc;
  console.log(`[job ${id}] spawned: ${YTDLP} ${args.join(" ")}`);

  proc.on("error", (err) => {
    console.error(`[job ${id}] spawn error:`, err.message);
    job.state = "error";
    job.error = "Could not launch yt-dlp: " + err.message;
  });

  proc.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) {
      const m = line.match(/^\[download\]\s+([\d.]+)%/);
      if (m) {
        job.pct = parseFloat(m[1]);
        continue;
      }
      if (/^\[(Merger|ExtractAudio|VideoConvertor|VideoRemuxer)\]/.test(line)) {
        job.state = "processing";
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.error(`[job ${id}] stderr:`, text.slice(0, 300));
    if (!job.error && text) job.error = text.split("\n")[0].slice(0, 200);
  });

  proc.on("close", async (code) => {
    if (code === 0) {
      try {
        const files = await fsp.readdir(dir);
        const file = files.find((f) => f.startsWith("dl."));
        if (file) {
          job.file = path.join(dir, file);
          job.pct = 100;
          job.state = "done";
          return;
        }
      } catch {}
    }
    job.state = "error";
  });

  res.json({ id });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json({ state: job.state, pct: job.pct, error: job.error });
});

app.get("/api/jobs/:id/file", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.state !== "done" || !job.file) {
    return res.status(409).json({ error: "File not ready." });
  }
  const ext = path.extname(job.file);
  const name = `${safeName(job.title || "download")}${job.label || ""}${ext}`;
  res.download(job.file, name, async (err) => {
    if (!err) {
      jobs.delete(job.id);
      await fsp.rm(path.dirname(job.file), { recursive: true, force: true }).catch(() => {});
    }
  });
});

setInterval(() => {
  for (const [id, job] of jobs) {
    if (Date.now() - (job.created || 0) > 3600000) {
      if (job.file) fsp.rm(path.dirname(job.file), { recursive: true, force: true }).catch(() => {});
      jobs.delete(id);
    }
  }
}, 600000).unref();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GoDown server running -> http://localhost:${PORT}`);
  console.log(`yt-dlp: ${YTDLP}`);
  console.log(`ffmpeg: ${FFMPEG_DIR}`);
});

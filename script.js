const $ = (id) => document.getElementById(id);

const form = $("dlForm");
const urlInput = $("urlInput");
const pasteBtn = $("pasteBtn");
const getBtn = $("getBtn");
const fieldError = $("urlError");
const result = $("result");
const thumbImg = $("thumbImg");
const durationBadge = $("durationBadge");
const videoTitle = $("videoTitle");
const channelName = $("channelName");
const viewsLabel = $("viewsLabel");
const viewsSep = $("viewsSep");
const formatList = $("formatList");
const startDlBtn = $("startDlBtn");
const startDlLabel = $("startDlLabel");
const progressWrap = $("progressWrap");
const progressBar = $("progressBar");
const progressFill = $("progressFill");
const progressStage = $("progressStage");
const progressPct = $("progressPct");
const successBox = $("successBox");
const fileNameEl = $("fileName");
const againBtn = $("againBtn");
const toasts = $("toasts");
const thumbBox = $("thumbBox");

async function apiFetch(url, opts = {}) {
  return fetch(url, opts);
}

let currentVideo = null;
let selectedKind = "mp4";
let selectedHeight = null;

const BITRATE_MBPS = { 144: 0.1, 240: 0.3, 360: 0.55, 480: 0.9, 720: 1.6, 1080: 2.7, 1440: 5, 2160: 13 };
const QUALITY_NAMES = { 2160: "4K", 1440: "2K", 1080: "Full HD", 720: "HD", 480: "SD" };

const ICONS = {
  video: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  audio: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`
};

function showToast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icons = { success: "✓", error: "✕", info: "ℹ" };
  el.innerHTML = `<span aria-hidden="true">${icons[type] || icons.info}</span><span>${message}</span>`;
  toasts.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, 3400);
}

function parseMediaUrl(value) {
  try {
    const u = new URL(value.trim());
    const host = u.hostname.replace(/^www\./, "");

    if (["x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com", "v.x.com"].includes(host)) {
      return /\/status\/\d+/.test(u.pathname) ? `https://x.com${u.pathname}` : null;
    }
    if (["instagram.com", "m.instagram.com", "instagr.am"].includes(host)) {
      const m = u.pathname.match(/^\/(p|reel|reels|tv)\/([\w-]+)/);
      if (m) return `https://www.instagram.com/${m[1]}/${m[2]}`;
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

function detectPlatform(value) {
  try {
    const host = new URL(value.trim()).hostname.replace(/^www\./, "");
    if (["x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com", "v.x.com"].includes(host)) return "x";
    if (["instagram.com", "m.instagram.com", "instagr.am"].includes(host)) return "instagram";
  } catch {}
  return null;
}

const PLATFORM_LABELS = { x: "X", instagram: "Instagram" };

function setPlatformUI(platform) {
  form.dataset.platform = platform || "";
  document.querySelectorAll(".platform-btn").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.platform === platform));
  });
}

function showError(message) {
  fieldError.textContent = message;
  fieldError.hidden = false;
  urlInput.setAttribute("aria-invalid", "true");
  urlInput.focus();
}

function clearError() {
  fieldError.hidden = true;
  fieldError.textContent = "";
  urlInput.removeAttribute("aria-invalid");
}

function setFetching(loading) {
  getBtn.disabled = loading;
  getBtn.classList.toggle("loading", loading);
  getBtn.querySelector(".btn-label").textContent = loading ? "Fetching…" : "Get video";
}

function formatDuration(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function formatViews(n) {
  if (!n && n !== 0) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K views`;
  return `${n} views`;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / 1073741824;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}

function estimateBytes(kind, height) {
  if (!currentVideo.lengthSec) return 0;
  if (kind === "mp3") return (currentVideo.lengthSec * 192 * 1024) / 8;
  const mbps = BITRATE_MBPS[height] || 1.5;
  return (currentVideo.lengthSec * mbps * 1048576) / 8;
}

function sizeSuffix(kind, height) {
  const bytes = estimateBytes(kind, height);
  return bytes ? ` · approx ${formatBytes(bytes)}` : "";
}

function curateHeights(heights) {
  const preferred = [2160, 1440, 1080, 720, 480, 360];
  const chosen = preferred.filter((h) => heights.includes(h));
  const max = Math.max(...heights);
  if (!chosen.includes(max)) chosen.unshift(max);
  return chosen.slice(0, 4);
}

function updateDlButton() {
  startDlLabel.textContent =
    selectedKind === "mp3" ? "Download MP3" : `Download MP4 · ${selectedHeight}p`;
}

function selectChip(btn, kind, height) {
  selectedKind = kind;
  selectedHeight = kind === "mp4" ? height : null;
  formatList.querySelectorAll(".option-row").forEach((c) => c.setAttribute("aria-checked", "false"));
  btn.setAttribute("aria-checked", "true");
  updateDlButton();
}

function renderFormats() {
  formatList.innerHTML = "";

  const rows = curateHeights(currentVideo.heights).map((h) => ({
    kind: "mp4",
    height: h,
    name: `${h}p`,
    badge: QUALITY_NAMES[h] || "",
    sub: `Video · MP4${sizeSuffix("mp4", h)}`
  }));

  if (currentVideo.hasAudio) {
    rows.push({
      kind: "mp3",
      height: null,
      name: "MP3",
      badge: "Audio only",
      sub: `Sound · MP3${sizeSuffix("mp3")}`
    });
  }

  rows.forEach((row, i) => {
    const isSelected =
      row.kind === selectedKind &&
      (row.kind === "mp3" || row.height === selectedHeight);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-row";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(isSelected));
    btn.style.setProperty("--i", String(i));

    const icon = document.createElement("span");
    icon.className = "option-icon";
    icon.innerHTML = row.kind === "mp3" ? ICONS.audio : ICONS.video;

    const text = document.createElement("span");
    text.className = "option-text";

    const name = document.createElement("span");
    name.className = "option-name";
    name.textContent = row.name;
    if (row.badge) {
      const em = document.createElement("em");
      em.textContent = row.badge;
      name.appendChild(em);
    }

    const sub = document.createElement("span");
    sub.className = "option-sub";
    sub.textContent = row.sub;

    text.append(name, sub);

    const radio = document.createElement("span");
    radio.className = "option-radio";
    radio.setAttribute("aria-hidden", "true");

    btn.append(icon, text, radio);
    btn.addEventListener("click", () => selectChip(btn, row.kind, row.height));
    formatList.appendChild(btn);
  });

  updateDlButton();
}

function pickDefaultHeight(heights) {
  for (const preferred of [720, 360, 1080, 480]) {
    if (heights.includes(preferred)) return preferred;
  }
  return heights[heights.length - 1] || 360;
}

async function handleGetVideo(e) {
  e.preventDefault();
  clearError();

  const canonical = parseMediaUrl(urlInput.value);
  if (!canonical) {
    return showError("That doesn't look like a valid X or Instagram link.");
  }
  setPlatformUI(detectPlatform(canonical));

  setFetching(true);

  try {
    const resp = await apiFetch(`/api/info?url=${encodeURIComponent(canonical)}`);
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || "Could not fetch video info.");
    if (data.live) throw new Error("Live streams can't be downloaded.");

    currentVideo = data;

    if (data.thumbnail) {
      thumbImg.src = data.thumbnail;
      thumbImg.style.display = "";
    } else {
      thumbImg.style.display = "none";
    }
    thumbImg.onerror = () => { thumbImg.style.display = "none"; };
    thumbBox.style.aspectRatio = "";
    videoTitle.textContent = data.title;
    const byline = [data.author || "", formatViews(data.views)].filter(Boolean);
    channelName.textContent = byline[0] || "";
    viewsSep.hidden = byline.length < 2;
    viewsLabel.textContent = byline[1] || "";
    durationBadge.textContent = formatDuration(data.lengthSec);
    durationBadge.hidden = !data.lengthSec;

    successBox.hidden = true;
    progressWrap.hidden = true;
    result.hidden = false;

    selectedKind = "mp4";
    selectedHeight = pickDefaultHeight(data.heights);
    startDlLabel.textContent = "Download";
    startDlBtn.disabled = false;
    renderFormats();
    showToast("Video loaded — choose a format and hit download.", "success");
  } catch (err) {
    result.hidden = true;
    showToast(err.message, "error");
  } finally {
    setFetching(false);
  }
}

startDlBtn.addEventListener("click", async () => {
  if (!currentVideo || startDlBtn.disabled) return;

  startDlBtn.disabled = true;
  successBox.hidden = true;
  progressWrap.hidden = false;
  setProgress(0, "Starting…");

  try {
    const createResp = await apiFetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: urlInput.value.trim(),
        type: selectedKind,
        height: selectedKind === "mp4" ? selectedHeight : undefined,
        title: currentVideo.title
      })
    });
    const created = await createResp.json();
    if (!createResp.ok) throw new Error(created.error || "Could not start the download.");

    const finalState = await pollJob(created.id);
    if (finalState.state === "error") {
      throw new Error(finalState.error || "Download failed.");
    }

    const ext = selectedKind === "mp3" ? ".mp3" : `_${selectedHeight}p.mp4`;
    fileNameEl.textContent = currentVideo.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 50) + ext;
    successBox.hidden = false;
    showToast("Your file is ready — saving to your device.", "success");

    setTimeout(() => {
      window.location.href = `/api/jobs/${created.id}/file`;
      progressWrap.hidden = true;
      progressFill.style.width = "0%";
      startDlLabel.textContent = "Download again";
      startDlBtn.disabled = false;
    }, 600);
  } catch (err) {
    progressWrap.hidden = true;
    startDlLabel.textContent = "Try again";
    startDlBtn.disabled = false;
    showToast(err.message, "error");
  }
});

function setProgress(pct, stage) {
  const rounded = Math.floor(pct);
  progressFill.style.width = `${pct}%`;
  progressBar.setAttribute("aria-valuenow", String(rounded));
  progressPct.textContent = `${rounded}%`;
  if (stage) progressStage.textContent = stage;
}

function pollJob(id) {
  return new Promise((resolve, reject) => {
    let lastPct = -1;
    const timer = setInterval(async () => {
      try {
        const resp = await apiFetch(`/api/jobs/${id}`);
        if (!resp.ok) {
          clearInterval(timer);
          return reject(new Error("Job lost on server."));
        }
        const state = await resp.json();

        if (state.pct > lastPct) {
          lastPct = state.pct;
          setProgress(
            state.pct,
            state.state === "processing" ? "Merging & converting…" :
            state.pct >= 100 ? "Finishing…" : "Downloading…"
          );
        } else if (state.state === "processing") {
          progressStage.textContent = "Merging & converting…";
        }

        if (state.state === "done" || state.state === "error") {
          clearInterval(timer);
          resolve(state);
        }
      } catch {
        clearInterval(timer);
        reject(new Error("Lost connection to the server."));
      }
    }, 700);
  });
}

againBtn.addEventListener("click", () => {
  result.hidden = true;
  successBox.hidden = true;
  progressWrap.hidden = true;
  urlInput.value = "";
  thumbBox.style.aspectRatio = "";
  setPlatformUI(null);
  clearError();
  urlInput.focus();
});

thumbImg.addEventListener("load", () => {
  const w = thumbImg.naturalWidth;
  const h = thumbImg.naturalHeight;
  if (!w || !h) return;
  const ratio = Math.min(16 / 9, Math.max(9 / 16, w / h));
  thumbBox.style.aspectRatio = ratio.toFixed(4);
});

pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) throw new Error("empty");
    urlInput.value = text.trim();
    clearError();
    showToast("Pasted from clipboard.");
    urlInput.focus();
  } catch {
    showToast("Clipboard unavailable — press Ctrl+V instead.", "error");
    urlInput.focus();
  }
});

urlInput.addEventListener("input", () => {
  if (!fieldError.hidden) clearError();
  setPlatformUI(detectPlatform(urlInput.value));
});

form.addEventListener("submit", handleGetVideo);

document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    document.activeElement !== urlInput &&
    !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)
  ) {
    e.preventDefault();
    urlInput.focus();
  }
});

const PLATFORM_PLACEHOLDERS = {
  x: "Paste an X (Twitter) video link here…",
  instagram: "Paste an Instagram video or reel link here…"
};

document.querySelectorAll(".platform-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const platform = btn.dataset.platform;
    urlInput.placeholder = PLATFORM_PLACEHOLDERS[platform] || urlInput.placeholder;
    setPlatformUI(platform);
    clearError();
    urlInput.focus();
    showToast(`Ready to paste a ${PLATFORM_LABELS[platform]} link.`);
  });
});

(function initTheme() {
  const saved = localStorage.getItem("godown-theme");
  const preferred = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = saved || preferred;
})();

$("themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("godown-theme", next);
});

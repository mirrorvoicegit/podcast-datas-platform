// ============================================================
// 節目收聽數據分析工具 v3(v16:支援 YouTube Podcast 版＋影音版雙來源)
// ============================================================

const state = {
  apple: null,
  spotify: null,
  ytFiles: [],   // 最多 2 筆:{id, originalName, zipName, csvNameInZip, rows, role, suggestedRole, confidence, reason}
  merged: null,
  sortBy: 'date',
  sortDir: 'desc',
  searchQuery: '',
  notes: {},
  fileInfo: {},
  hasVideoSource: false,
};

const charts = {};
let staged = null;

document.getElementById('today-date').textContent =
  new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

// ============================================================
// 0. EP 編號辨識 + YouTube 角色關鍵字(集中設定)
// ============================================================
const EP_PATTERN = /(?:EP|Ep|ep)[\s.\-]?(\d{1,5})|第\s?(\d{1,5})\s?集/;
const EP_STRIP_PATTERN = /(?:EP|Ep|ep)[\s.\-]?\d{1,5}|第\s?\d{1,5}\s?集/g;

function extractEpisodeNumber(title) {
  if (!title) return { raw: null, key: null, found: false };
  const m = title.match(EP_PATTERN);
  if (!m) return { raw: null, key: null, found: false };
  const num = m[1] || m[2];
  return { raw: m[0], key: String(parseInt(num, 10)), found: true };
}

const YT_ROLE_KEYWORDS = {
  video: ['影音版', '影片版', '影像版', '影音', 'video', 'full video', '完整版影片'],
  podcast: ['純podcast', 'podcast版', '音訊版', '聲音版', 'audio', 'voice'],
};

function normalizeForKeywordMatch(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[　\s_\-]/g, '')
    .replace(/[「」『』【】\[\]()（）.,，、]/g, '');
}

function detectYtRoleFromFilename(name) {
  const norm = normalizeForKeywordMatch(name);
  const hitVideo = YT_ROLE_KEYWORDS.video.some(k => norm.includes(normalizeForKeywordMatch(k)));
  const hitPodcast = YT_ROLE_KEYWORDS.podcast.some(k => norm.includes(normalizeForKeywordMatch(k)));
  if (hitVideo && hitPodcast) {
    return { role: null, confidence: 'conflict', reason: '檔名同時含影音版與 Podcast 版關鍵字,無法判斷' };
  }
  if (hitVideo) return { role: 'video', confidence: 'high', reason: '檔名含「影音版」類關鍵字' };
  if (hitPodcast) return { role: 'podcast', confidence: 'high', reason: '檔名含「Podcast 版」類關鍵字' };
  return { role: null, confidence: null, reason: null };
}

// Podcast 版／影音版標題比對用(方向 B,維護者定案):
// 去括號區塊(節目名｜EP 前後綴)+ emoji + 頭尾的行銷裝飾詞後再比較,
// 只在標題「頭尾」去除裝飾詞,不動句子中間的正常用詞(避免把真正不同的標題誤判成相同)。
const YT_TITLE_MARKETING_WORDS = ['獨家', '直擊', '完整版', '精華版', '花絮', '首播'];
const TITLE_EDGE_PUNCT = /^[、，。！？：；「」『』【】()（）\[\]\-–—_.,!?:;'"~〜･·•\s]+|[、，。！？：；「」『』【】()（）\[\]\-–—_.,!?:;'"~〜･·•\s]+$/g;
const TITLE_EMOJI_RANGE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

function normalizeYtTitleForCompare(title) {
  if (!title) return '';
  let s = title.replace(/[【『「\[][^】』」\]]*[】』」\]]/g, '');
  s = s.replace(TITLE_EMOJI_RANGE, '');
  let prev;
  do {
    prev = s;
    s = s.replace(TITLE_EDGE_PUNCT, '');
    YT_TITLE_MARKETING_WORDS.forEach(w => {
      if (s.startsWith(w)) s = s.slice(w.length);
      if (s.endsWith(w)) s = s.slice(0, -w.length);
    });
  } while (s !== prev);
  s = s.replace(/[、，。！？：；「」『』【】()（）\[\]\-–—_.,!?:;'"~〜･·•\s]/g, '');
  return s.toLowerCase();
}

// ============================================================
// 期間選擇(下拉選單,全部用日曆單位,依上架日)
// ============================================================
function computePeriod(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const toStr = iso(today);

  switch (preset) {
    case 'lastweek': {
      const dow = today.getDay() === 0 ? 7 : today.getDay();
      const thisMonday = new Date(today);
      thisMonday.setDate(today.getDate() - (dow - 1));
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      const lastSunday = new Date(thisMonday);
      lastSunday.setDate(thisMonday.getDate() - 1);
      return { from: iso(lastMonday), to: iso(lastSunday) };
    }
    case 'last30days': {
      const from = new Date(today);
      from.setDate(today.getDate() - 30);
      return { from: iso(from), to: toStr };
    }
    case 'thisyear': {
      const first = new Date(today.getFullYear(), 0, 1);
      return { from: iso(first), to: toStr };
    }
    case 'all': {
      const earliest = getEarliestReleaseDate();
      return { from: earliest ? iso(earliest) : '', to: toStr };
    }
    default:
      return null;
  }
}

function getEarliestReleaseDate() {
  const allItems = [
    ...(state.apple || []),
    ...(state.spotify || []),
    ...state.ytFiles.flatMap(f => f.rows),
  ];
  let earliest = null;
  for (const item of allItems) {
    const d = parseDate(item.releaseDate);
    if (d && (!earliest || d < earliest)) earliest = d;
  }
  return earliest;
}

function applyPeriodSelect() {
  const sel = document.getElementById('period-select');
  const preset = sel.value;
  const customRow = document.getElementById('period-custom-row');
  const note = document.getElementById('period-active-note');

  if (preset === 'custom') {
    customRow.style.display = 'flex';
    if (note) note.textContent = '請在下方手動選擇起訖日';
    return;
  }
  customRow.style.display = 'none';

  const range = computePeriod(preset);
  if (range) {
    document.getElementById('date-from').value = range.from;
    document.getElementById('date-to').value = range.to;
    if (note) {
      if (range.from && range.to) {
        note.textContent = `${range.from} ~ ${range.to} 上架`;
      } else if (range.to) {
        note.textContent = `全部集數`;
      }
    }
  }
}

document.getElementById('period-select').addEventListener('change', applyPeriodSelect);

['date-from', 'date-to'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const sel = document.getElementById('period-select');
    if (sel.value !== 'custom') {
      sel.value = 'custom';
      document.getElementById('period-custom-row').style.display = 'flex';
    }
    const note = document.getElementById('period-active-note');
    if (note) note.textContent = '自訂區間';
  });
});

(function initDateRange() {
  applyPeriodSelect();
})();

(function initShowNameMemory() {
  const input = document.getElementById('show-name');
  if (!input) return;
  try {
    const saved = localStorage.getItem('tool1ShowName');
    if (saved) input.value = saved;
  } catch (e) { /* ignore */ }
  input.addEventListener('input', () => {
    try { localStorage.setItem('tool1ShowName', input.value.trim()); } catch (e) { /* ignore */ }
  });
})();

(function initProducerMemory() {
  const input = document.getElementById('producer-name');
  if (!input) return;
  try {
    const saved = localStorage.getItem('tool1Producer');
    if (saved) input.value = saved;
  } catch (e) { /* ignore */ }
  input.addEventListener('input', () => {
    try { localStorage.setItem('tool1Producer', input.value.trim()); } catch (e) { /* ignore */ }
  });
})();

(function initSubscriberMemory() {
  const fields = [
    { id: 'sub-apple', key: 'tool1SubApple' },
    { id: 'sub-spotify', key: 'tool1SubSpotify' },
    { id: 'sub-yt', key: 'tool1SubYt' },
  ];
  fields.forEach(({ id, key }) => {
    const input = document.getElementById(id);
    if (!input) return;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        input.placeholder = `上次:${saved}`;
        input.dataset.lastValue = saved;
      }
    } catch (e) { /* ignore */ }
    input.addEventListener('input', () => {
      const v = input.value.trim();
      if (!v) return;
      try {
        localStorage.setItem(key, v);
        localStorage.setItem(key + 'At', localDateStr());
      } catch (e) { /* ignore */ }
    });
  });
})();

// ============================================================
// 1. 上傳(拖曳或點選,自動辨識平台;支援 CSV 與 YouTube ZIP)
// ============================================================
function detectPlatform(headers) {
  if (!headers) return null;
  const has = name => headers.includes(name);
  if (has('Episode Title') && has('Plays')) return 'apple';
  if (has('name') && has('plays')) return 'spotify';
  if (has('影片標題') && has('觀看次數')) return 'yt';
  return null;
}

const dropzoneAll = document.getElementById('dropzone-all');
const fileAllInput = document.getElementById('file-all');

fileAllInput.addEventListener('change', e => {
  handleMultipleFiles(Array.from(e.target.files));
  fileAllInput.value = '';
});

['dragenter', 'dragover'].forEach(ev => {
  dropzoneAll.addEventListener(ev, e => {
    e.preventDefault();
    dropzoneAll.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach(ev => {
  dropzoneAll.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === 'dragleave' && dropzoneAll.contains(e.relatedTarget)) return;
    dropzoneAll.classList.remove('dragover');
  });
});
dropzoneAll.addEventListener('drop', e => {
  const files = Array.from(e.dataTransfer.files).filter(f => {
    const n = f.name.toLowerCase();
    return n.endsWith('.csv') || n.endsWith('.zip');
  });
  handleMultipleFiles(files);
});

// 讀單一檔案(CSV 或 ZIP),回傳 { platform, rows, meta }。
// ZIP 只找「表格資料.csv」(FR-2),不要誤把 總計.csv / 圖表資料.csv 當單集資料。
async function readSourceFile(file) {
  const lowerName = file.name.toLowerCase();
  let csvText, zipName = null, csvNameInZip = null;

  if (lowerName.endsWith('.zip')) {
    if (typeof JSZip === 'undefined') {
      throw new Error('ZIP 解析函式庫載入失敗,請改上傳解壓後的 CSV');
    }
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    let entry = null, entryName = null;
    zip.forEach((relPath, e) => {
      if (entry || e.dir) return;
      const base = relPath.split('/').pop();
      if (base === '表格資料.csv') { entry = e; entryName = relPath; }
    });
    if (!entry) throw new Error('ZIP 內找不到「表格資料.csv」');
    csvText = await entry.async('string');
    zipName = file.name;
    csvNameInZip = entryName;
  } else {
    csvText = await file.text();
  }

  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const headers = parsed.meta && parsed.meta.fields ? parsed.meta.fields : [];
  const platform = detectPlatform(headers);
  if (!platform) {
    throw new Error(zipName ? 'ZIP 內的表格資料.csv 認不出平台' : '認不出平台');
  }
  const rows = parsePlatformCSV(platform, parsed.data);
  return { platform, rows, meta: { originalName: file.name, zipName, csvNameInZip } };
}

let ytFileSeq = 0;

async function handleMultipleFiles(files) {
  if (!files.length) return;
  const errs = [];

  const results = await Promise.all(files.map(async file => {
    try {
      const r = await readSourceFile(file);
      return { file, ...r };
    } catch (err) {
      errs.push({ name: file.name, msg: err.message || '解析失敗' });
      return null;
    }
  }));

  results.filter(Boolean).forEach(r => {
    if (r.platform === 'apple' || r.platform === 'spotify') {
      state[r.platform] = r.rows;
      state.fileInfo[r.platform] = { name: r.meta.zipName || r.meta.originalName, count: r.rows.length };
    } else if (r.platform === 'yt') {
      if (state.ytFiles.length >= 2) {
        errs.push({ name: r.meta.originalName, msg: '已有兩份 YouTube 資料,請先移除一份再上傳' });
        return;
      }
      const displayName = r.meta.zipName || r.meta.originalName;
      const suggestion = detectYtRoleFromFilename(displayName);
      state.ytFiles.push({
        id: 'yt' + (++ytFileSeq),
        originalName: r.meta.originalName,
        zipName: r.meta.zipName,
        csvNameInZip: r.meta.csvNameInZip,
        rows: r.rows,
        role: null,
        suggestedRole: suggestion.role,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
      });
    }
  });

  finishMulti(errs);
}

const PLATFORM_LABEL = { apple: 'APPLE', spotify: 'SPOTIFY' };

function ytRoleLabel(f) {
  if (f.role === 'video') return 'YOUTUBE 影音版';
  if (f.role === 'podcast') return 'YOUTUBE PODCAST';
  return 'YOUTUBE(待確認)';
}

function renderFilesList(errs = []) {
  const listEl = document.getElementById('dropzone-msg');
  const uploadedCount = ['apple', 'spotify'].filter(p => state.fileInfo[p]).length + (state.ytFiles.length > 0 ? 1 : 0);

  dropzoneAll.classList.toggle('uploaded', uploadedCount > 0);
  let html = '';
  if (uploadedCount > 0) {
    html += `<div class="upload-status">✓ 已上傳 ${uploadedCount} 個來源</div>`;
  }
  ['apple', 'spotify'].forEach(p => {
    const info = state.fileInfo[p];
    if (info) {
      html += `<div class="file-row">
        <span class="file-platform ${p}">${PLATFORM_LABEL[p]}</span>
        <span class="file-name" title="${escapeAttr(info.name)}">${escapeHtml(info.name)}</span>
        <span class="file-rows">${info.count.toLocaleString('zh-TW')} 筆</span>
        <button class="file-remove" data-platform="${p}" title="移除">✕</button>
      </div>`;
    }
  });
  state.ytFiles.forEach((f, idx) => {
    const displayName = f.zipName || f.originalName;
    html += `<div class="file-row">
      <span class="file-platform yt">${ytRoleLabel(f)}</span>
      <span class="file-name" title="${escapeAttr(displayName)}">${escapeHtml(displayName)}</span>
      <span class="file-rows">${f.rows.length.toLocaleString('zh-TW')} 筆</span>
      <button class="file-remove" data-yt-idx="${idx}" title="移除">✕</button>
    </div>`;
  });
  errs.forEach(e => {
    html += `<div class="file-row error">
      <span class="file-platform err">無法辨識</span>
      <span class="file-name" title="${escapeAttr(e.name)}">${escapeHtml(e.name)}</span>
      <span class="file-rows">${escapeHtml(e.msg)}</span>
      <span></span>
    </div>`;
  });
  listEl.innerHTML = html;

  listEl.querySelectorAll('.file-remove[data-platform]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const p = btn.dataset.platform;
      state[p] = null;
      delete state.fileInfo[p];
      renderFilesList();
      checkReadyToGenerate();
    });
  });
  listEl.querySelectorAll('.file-remove[data-yt-idx]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const idx = parseInt(btn.dataset.ytIdx, 10);
      state.ytFiles.splice(idx, 1);
      renderFilesList();
      checkReadyToGenerate();
    });
  });
}

function finishMulti(errs) {
  renderFilesList(errs);
  checkReadyToGenerate();
}

function checkReadyToGenerate() {
  const hasAtLeastTwo = [state.apple, state.spotify, state.ytFiles.length > 0 ? true : null].filter(Boolean).length >= 2;
  document.getElementById('btn-generate').disabled = !hasAtLeastTwo;
}

// ============================================================
// 2. CSV 解析
// ============================================================
// FR-12:數值解析不可把空白/解析失敗靜默轉成 0,要跟真正的 0 分開。
function parsePlaysNullable(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = parseInt(s.replace(/,/g, ''), 10);
  return isNaN(n) ? null : n;
}

function parsePlatformCSV(platform, rows) {
  if (!rows || rows.length === 0) throw new Error('檔案是空的');

  if (platform === 'apple') {
    if (!('Episode Title' in rows[0]) || !('Plays' in rows[0])) {
      throw new Error('這不像 Apple CSV(缺少 Episode Title 或 Plays 欄位)');
    }
    return rows
      .filter(r => r['Episode Title'] && r['Episode Title'].trim())
      .map(r => ({
        title: r['Episode Title'].trim(),
        plays: parseInt(r['Plays']) || 0,
        releaseDate: r['Release Date'] || '',
        duration: parseInt(r['Duration']) || 0,
      }));
  }

  if (platform === 'spotify') {
    if (!('name' in rows[0]) || !('plays' in rows[0])) {
      throw new Error('這不像 Spotify CSV(缺少 name 或 plays 欄位)');
    }
    return rows
      .filter(r => r.name && r.name.trim())
      .map(r => ({
        title: r.name.trim(),
        plays: parseInt(r.plays) || 0,
        releaseDate: r.releaseDate || '',
        duration: 0,
      }));
  }

  if (platform === 'yt') {
    if (!('影片標題' in rows[0]) || !('觀看次數' in rows[0])) {
      throw new Error('這不像 YouTube 表格資料.csv(缺少 影片標題 或 觀看次數 欄位)');
    }
    return rows
      .filter(r => r['影片標題'] && r['影片標題'].trim() && r['內容'] !== '總計')
      .map(r => {
        const ep = extractEpisodeNumber(r['影片標題'].trim());
        return {
          title: r['影片標題'].trim(),
          plays: parsePlaysNullable(r['觀看次數']),
          releaseDate: r['影片發布時間'] || '',
          duration: parseInt(r['時間長度']) || 0,
          videoId: r['內容'] || '',
          epRaw: ep.raw,
          epKey: ep.key,
          epFound: ep.found,
        };
      });
  }
}

// ============================================================
// 3. 流程控制
// ============================================================
document.getElementById('btn-generate').addEventListener('click', startGenerateFlow);
document.getElementById('btn-reset').addEventListener('click', () => location.reload());

document.getElementById('btn-fuzzy-next').addEventListener('click', enterOrphanReview);
document.getElementById('btn-fuzzy-back').addEventListener('click', () => {
  document.getElementById('fuzzy-section').style.display = 'none';
  document.getElementById('upload-section').style.display = 'block';
  window.scrollTo({top: 0, behavior: 'smooth'});
});
document.getElementById('btn-fuzzy-all').addEventListener('click', () => toggleAllFuzzy(true));
document.getElementById('btn-fuzzy-none').addEventListener('click', () => toggleAllFuzzy(false));

document.getElementById('btn-final-generate').addEventListener('click', generateReport);
document.getElementById('btn-back-upload').addEventListener('click', () => {
  document.getElementById('orphan-section').style.display = 'none';
  document.getElementById('fuzzy-section').style.display = 'block';
  window.scrollTo({top: 0, behavior: 'smooth'});
});
document.getElementById('btn-orphan-all').addEventListener('click', () => toggleAllOrphans(true));
document.getElementById('btn-orphan-none').addEventListener('click', () => toggleAllOrphans(false));

document.getElementById('btn-back').addEventListener('click', () => {
  document.getElementById('report').classList.remove('active');
  document.getElementById('upload-section').style.display = 'block';
  document.getElementById('ytrole-section').style.display = 'none';
  document.getElementById('fuzzy-section').style.display = 'none';
  document.getElementById('orphan-section').style.display = 'none';
  window.scrollTo({top: 0, behavior: 'smooth'});
});

function startGenerateFlow() {
  if (state.ytFiles.length === 2) {
    enterYtRoleReview();
  } else {
    resolveYtSources();
    enterFuzzyReview();
  }
}

// 依 state.ytFiles[].role 決定本次是否有雙來源(FR-13)。
// 只有 1 份 YouTube 資料時,完全比照舊行為,只是內部欄位改名為 youtubePodcast。
function resolveYtSources() {
  const files = state.ytFiles;
  let podcastRows = null, videoRows = null;

  if (files.length === 1) {
    podcastRows = files[0].rows;
  } else if (files.length === 2) {
    const podcastFile = files.find(f => f.role === 'podcast');
    const videoFile = files.find(f => f.role === 'video');
    podcastRows = podcastFile ? podcastFile.rows : null;
    videoRows = videoFile ? videoFile.rows : null;
  }

  state.hasVideoSource = !!(podcastRows && videoRows);
  state.ytPodcastRows = podcastRows;
  state.ytVideoRows = videoRows;
}

// ============================================================
// 3.5 YouTube 角色確認(FR-5/FR-6)
// ============================================================
function countEpMatches(rowsA, rowsB) {
  const bKeys = new Set(rowsB.filter(r => r.epFound).map(r => r.epKey));
  const seen = new Set();
  let n = 0;
  rowsA.filter(r => r.epFound).forEach(r => {
    if (bKeys.has(r.epKey) && !seen.has(r.epKey)) { n++; seen.add(r.epKey); }
  });
  return n;
}

// FR-6 優先順序:檔名關鍵字建議(第3順位)>推定另一份的相反角色 > 都不確定則不預選,強制使用者指定。
function assignDefaultYtRoles(files) {
  const [a, b] = files;
  const aHit = a.suggestedRole, bHit = b.suggestedRole;

  if (aHit && bHit && aHit !== bHit) {
    a.role = aHit; b.role = bHit;
    return;
  }
  if (aHit && !bHit) {
    a.role = aHit; b.role = aHit === 'video' ? 'podcast' : 'video';
    if (!b.reason) b.reason = '未偵測到檔名關鍵字,依另一份檔案推定為相反角色';
    return;
  }
  if (bHit && !aHit) {
    b.role = bHit; a.role = bHit === 'video' ? 'podcast' : 'video';
    if (!a.reason) a.reason = '未偵測到檔名關鍵字,依另一份檔案推定為相反角色';
    return;
  }
  // 兩邊建議相同(衝突)或都沒有建議:不自動指派
  a.role = null; b.role = null;
  if (!a.reason) a.reason = '系統無法從檔案內容可靠判斷兩份 YouTube 資料的版本,請指定後繼續。';
  if (!b.reason) b.reason = '系統無法從檔案內容可靠判斷兩份 YouTube 資料的版本,請指定後繼續。';
}

function enterYtRoleReview() {
  const files = state.ytFiles;
  assignDefaultYtRoles(files);
  renderYtRoleSection(files);
  document.getElementById('upload-section').style.display = 'none';
  document.getElementById('ytrole-section').style.display = 'block';
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function renderYtRoleSection(files) {
  const wrap = document.getElementById('ytrole-cards');
  const matchPreview = countEpMatches(files[0].rows, files[1].rows);

  wrap.innerHTML = files.map((f, idx) => {
    const displayName = f.zipName || f.originalName;
    const reasonText = f.reason || '尚未判斷';
    return `
      <div class="ytrole-card">
        <div class="ytrole-filename" title="${escapeAttr(displayName)}">${escapeHtml(displayName)}</div>
        <div class="ytrole-meta">${f.rows.length} 集 · 依 EP 編號可配對約 ${matchPreview} 集</div>
        <div class="ytrole-reason">${escapeHtml(reasonText)}</div>
        <select class="ytrole-select" data-idx="${idx}">
          <option value="" ${!f.role ? 'selected' : ''}>請選擇…</option>
          <option value="podcast" ${f.role === 'podcast' ? 'selected' : ''}>YouTube Podcast 版</option>
          <option value="video" ${f.role === 'video' ? 'selected' : ''}>YouTube 影音版</option>
          <option value="ignore" ${f.role === 'ignore' ? 'selected' : ''}>忽略此檔案</option>
        </select>
      </div>
    `;
  }).join('');

  wrap.querySelectorAll('.ytrole-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx, 10);
      state.ytFiles[idx].role = sel.value || null;
      updateYtRoleStatus();
    });
  });

  updateYtRoleStatus();
}

function updateYtRoleStatus() {
  const files = state.ytFiles;
  const statusEl = document.getElementById('ytrole-status');
  const btn = document.getElementById('btn-ytrole-continue');
  const roles = files.map(f => f.role);

  if (roles.includes(null) || roles.includes(undefined)) {
    statusEl.textContent = '請為兩份檔案分別選擇角色(或忽略)後繼續。';
    btn.disabled = true;
    return;
  }
  const active = roles.filter(r => r !== 'ignore');
  if (active.length === 2 && active[0] === active[1]) {
    statusEl.textContent = '兩份檔案不能指定成相同角色,請重新選擇。';
    btn.disabled = true;
    return;
  }
  statusEl.textContent = '';
  btn.disabled = false;
}

document.getElementById('btn-ytrole-swap').addEventListener('click', () => {
  const files = state.ytFiles;
  if (files.length !== 2) return;
  const tmp = files[0].role;
  files[0].role = files[1].role;
  files[1].role = tmp;
  renderYtRoleSection(files);
});

document.getElementById('btn-ytrole-continue').addEventListener('click', () => {
  resolveYtSources();
  document.getElementById('ytrole-section').style.display = 'none';
  enterFuzzyReview();
});
document.getElementById('btn-ytrole-back').addEventListener('click', () => {
  document.getElementById('ytrole-section').style.display = 'none';
  document.getElementById('upload-section').style.display = 'block';
  window.scrollTo({top: 0, behavior: 'smooth'});
});

// ============================================================
// 4. YouTube 跨版本(Podcast 版 ↔ 影音版)EP 編號精準配對(FR-8 最強訊號)
// ============================================================
// 只處理「雙方 EP 都唯一」的高信心配對。EP 缺席／重複／對方找不到唯一對應,
// 一律留下來變成單一欄位的「孤兒」項目,交給下面泛化過的 findFuzzyPairs
// (已擴充成同時認得 apple/spotify/youtubePodcast/youtubeVideo 四種孤兒)
// 用標題相似度配對——這樣就不需要另外寫一套跨版本比對邏輯,也天然支援
// 「沒有 EP 編號」或「EP 對不上但標題像」的節目,不是只為特定節目寫死。
function matchYtByEpisodeNumber(podcastRows, videoRows) {
  function buildEpMap(rows) {
    const map = new Map();
    rows.forEach(r => {
      if (!r.epFound) return;
      if (!map.has(r.epKey)) map.set(r.epKey, []);
      map.get(r.epKey).push(r);
    });
    return map;
  }
  const pEpMap = buildEpMap(podcastRows);
  const vEpMap = buildEpMap(videoRows);
  const usedP = new Set();
  const usedV = new Set();
  const matched = [];

  podcastRows.forEach(p => {
    if (!p.epFound) return;
    if (pEpMap.get(p.epKey).length > 1) return; // 本檔重複 EP,不能靠 EP 挑一支(FR-9)
    const vCands = vEpMap.get(p.epKey) || [];
    if (vCands.length === 1) {
      matched.push({ p, v: vCands[0] });
      usedP.add(p); usedV.add(vCands[0]);
    }
  });

  return {
    matched,
    remainP: podcastRows.filter(p => !usedP.has(p)),
    remainV: videoRows.filter(v => !usedV.has(v)),
  };
}

function makeYtCombinedItem(podcastRow, videoRow, status, confidence) {
  const title = podcastRow ? podcastRow.title : videoRow.title;
  const releaseDate = podcastRow ? podcastRow.releaseDate : videoRow.releaseDate;
  const item = {
    title,
    releaseDate,
    youtubePodcast: podcastRow ? podcastRow.plays : null,
    youtubeVideo: videoRow ? videoRow.plays : null,
    videoMatchStatus: status,
    videoMatchConfidence: confidence,
  };
  if (podcastRow && videoRow && normalizeYtTitleForCompare(podcastRow.title) !== normalizeYtTitleForCompare(videoRow.title)) {
    item.ytVideoOriginalTitle = videoRow.title;
  }
  return item;
}

// ============================================================
// 5. 進入可疑配對審查(跨平台 + 跨版本共用同一套 UI)
// ============================================================
function enterFuzzyReview() {
  const sel = document.getElementById('period-select');
  if (sel && sel.value === 'all') applyPeriodSelect();

  const shortsThreshold = parseInt(document.getElementById('shorts-threshold').value) || 180;
  const dateFrom = parseDate(document.getElementById('date-from').value);
  const dateTo = parseDate(document.getElementById('date-to').value);
  if (dateTo) dateTo.setHours(23, 59, 59, 999);

  // FR-21(維護者定案):四個來源的日期都可能有 ±1 天誤差,沒有一個是可信基準,
  // 「上線日」改回用該集任一來源最早取得的日期(見 mergeFirstPass 的 dateObj 說明),
  // 不再獨尊 Apple。但期間篩選「先合併、再用同一個日期篩選」這個執行順序維持不變
  // ——原本(v16)是在合併比對出「同一集」之前,各平台各自用自己的日期獨立過濾原始
  // 資料,若某平台日期跟其他平台差一天,同一集會被 A 平台留下、B 平台濾掉,造成
  // 同一集在分析區間內三平台對不上,這是實際發生過的 bug,不是假設風險。改成
  // 先合併比對出「同一集」、才用該集統一的 dateObj 做期間篩選,三平台判斷基準
  // 一致,不會因為改回「不獨尊 Apple」就讓這個 bug 復發。
  const apple = state.apple || [];
  const spotify = state.spotify || [];

  // Shorts 門檻(FR-17)是資料品質過濾、跟期間篩選無關,套用全部原始資料,不受期間影響。
  const rawPodcast = state.ytPodcastRows || [];
  const rawVideo = state.ytVideoRows || [];
  const podcastKept = rawPodcast.filter(r => r.duration >= shortsThreshold);
  const videoKept = rawVideo.filter(r => r.duration >= shortsThreshold);
  state.excludedShortsCount = (rawPodcast.length - podcastKept.length) + (rawVideo.length - videoKept.length);

  let ytCombined;
  if (state.hasVideoSource) {
    const { matched, remainP, remainV } = matchYtByEpisodeNumber(podcastKept, videoKept);
    ytCombined = [];
    matched.forEach(({ p, v }) => ytCombined.push(makeYtCombinedItem(p, v, 'matched_auto', 1)));
    remainP.forEach(p => ytCombined.push(makeYtCombinedItem(p, null, 'unmatched', null)));
    remainV.forEach(v => ytCombined.push(makeYtCombinedItem(null, v, 'unmatched', null)));
  } else {
    ytCombined = podcastKept.map(p => makeYtCombinedItem(p, null, null, null));
  }

  const mergedAll = mergeFirstPass(apple, spotify, ytCombined);

  // 四個來源都沒有可解析日期的集數(理論上少見)一律保留、不參與期間篩選判斷,
  // 不然會直接消失、使用者根本看不到有這一集存在。
  const merged = mergedAll.filter(d => {
    if (!d.dateObj) return true;
    if (dateFrom && d.dateObj < dateFrom) return false;
    if (dateTo && d.dateObj > dateTo) return false;
    return true;
  });

  const fuzzyPairs = findFuzzyPairs(merged);

  staged = { merged, fuzzyPairs, dateFrom, dateTo };

  if (fuzzyPairs.length === 0) {
    enterOrphanReview();
    return;
  }

  renderFuzzyTable(fuzzyPairs);

  document.getElementById('upload-section').style.display = 'none';
  document.getElementById('ytrole-section').style.display = 'none';
  document.getElementById('fuzzy-section').style.display = 'block';
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function renderFuzzyTable(pairs) {
  pairs.sort((a, b) => b.sim - a.sim);
  const SINGLE_PLATFORMS = ['apple', 'spotify', 'youtubePodcast', 'youtubeVideo'];
  const activeOf = e => SINGLE_PLATFORMS.filter(pl => e[pl] !== null);
  const isYtOnly = plats => plats.length === 1 && (plats[0] === 'youtubePodcast' || plats[0] === 'youtubeVideo');

  const tbody = document.getElementById('fuzzy-tbody');
  tbody.innerHTML = pairs.map((p, i) => {
    const targetPlatforms = activeOf(p.target);
    const matchPlatforms = activeOf(p.match);
    const targetIsYtOnly = isYtOnly(targetPlatforms);
    const matchIsYtOnly = isYtOnly(matchPlatforms);

    let leftTitle, rightTitle;
    if (targetIsYtOnly && matchIsYtOnly) {
      const targetIsPodcast = targetPlatforms[0] === 'youtubePodcast';
      leftTitle = targetIsPodcast ? p.target.title : p.match.title;
      rightTitle = targetIsPodcast ? p.match.title : p.target.title;
    } else if (targetIsYtOnly) {
      leftTitle = p.match.title; rightTitle = p.target.title;
    } else if (matchIsYtOnly) {
      leftTitle = p.target.title; rightTitle = p.match.title;
    } else {
      leftTitle = p.target.title; rightTitle = p.match.title;
    }

    const dateDiff = dateDiffDays(p.target.dateObj, p.match.dateObj);
    const ambiguousTag = p.ambiguous
      ? '<span class="tag" style="background:rgba(244,226,133,0.6);color:#7a5d00;border:none;margin-left:6px;">候選相近,請確認</span>'
      : '';

    return `
      <tr data-fuzzy-idx="${i}">
        <td><input type="checkbox" class="fuzzy-cb" data-idx="${i}" ${p.defaultChecked !== false ? 'checked' : ''}></td>
        <td class="title-cell">${escapeHtml(leftTitle)}${ambiguousTag}</td>
        <td class="title-cell">${escapeHtml(rightTitle)}</td>
        <td class="num">${dateDiff === 0 ? '同天' : (isFinite(dateDiff) ? dateDiff + ' 天' : '—')}</td>
        <td class="num"><strong>${(p.sim * 100).toFixed(0)}%</strong></td>
      </tr>
    `;
  }).join('');

  document.querySelectorAll('.fuzzy-cb').forEach(cb => {
    cb.addEventListener('change', updateFuzzyCounter);
  });
  updateFuzzyCounter();
}

function toggleAllFuzzy(checked) {
  document.querySelectorAll('.fuzzy-cb').forEach(cb => cb.checked = checked);
  document.querySelectorAll('#fuzzy-tbody tr').forEach(tr => {
    tr.classList.toggle('unchecked', !checked);
  });
  updateFuzzyCounter();
}

function updateFuzzyCounter() {
  const all = document.querySelectorAll('.fuzzy-cb');
  const checked = document.querySelectorAll('.fuzzy-cb:checked');
  document.getElementById('fuzzy-counter').textContent = `${checked.length} / ${all.length}`;
  document.querySelectorAll('#fuzzy-tbody tr').forEach(tr => {
    const cb = tr.querySelector('.fuzzy-cb');
    if (cb) tr.classList.toggle('unchecked', !cb.checked);
  });
}

// ============================================================
// 6. 進入孤兒審查
// ============================================================
const YT_ALL_PLATFORMS = ['apple', 'spotify', 'youtubePodcast', 'youtubeVideo'];

function enterOrphanReview() {
  const approvedPairs = [];
  document.querySelectorAll('.fuzzy-cb:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    if (!isNaN(idx)) approvedPairs.push(staged.fuzzyPairs[idx]);
  });

  const mergedKeys = new Set();
  approvedPairs.forEach(p => {
    const targetPlatform = YT_ALL_PLATFORMS.find(pl => p.target[pl] !== null);
    if (targetPlatform && p.match[targetPlatform] === null) {
      p.match[targetPlatform] = p.target[targetPlatform];
      p.match._fuzzyMatched = true;
      if (targetPlatform === 'youtubeVideo') {
        if (normalizeYtTitleForCompare(p.match.title) !== normalizeYtTitleForCompare(p.target.title)) p.match._ytVideoOriginalTitle = p.target.title;
      } else if (targetPlatform === 'youtubePodcast') {
        // 併入的是 Podcast 版孤兒,原本項目是以影音版標題建立的:改用 Podcast 標題當主標題。
        if (normalizeYtTitleForCompare(p.match.title) !== normalizeYtTitleForCompare(p.target.title)) {
          p.match._ytVideoOriginalTitle = p.match.title;
          p.match.title = p.target.title;
        }
      } else if (targetPlatform === 'apple' || targetPlatform === 'spotify') {
        p.match._ytOriginalTitle = p.match._ytOriginalTitle || null;
      }
      mergedKeys.add(p.target._key);
    }
  });

  staged.merged = staged.merged.filter(d => !mergedKeys.has(d._key));

  state.approvedFuzzy = approvedPairs.map(p => {
    const platform = YT_ALL_PLATFORMS.find(pl => p.target[pl] !== null);
    return { targetKey: p.target._key, matchKey: p.match._key, platform };
  }).filter(r => r.platform);

  staged.merged.forEach(d => {
    d.total = (d.apple || 0) + (d.spotify || 0) + (d.youtubePodcast || 0) + (d.youtubeVideo || 0);
  });

  staged.merged.sort((a, b) => {
    if (!a.dateObj && !b.dateObj) return 0;
    if (!a.dateObj) return 1;
    if (!b.dateObj) return -1;
    return b.dateObj - a.dateObj;
  });

  const orphans = staged.merged.filter(d => {
    return [d.apple, d.spotify, d.youtubePodcast, d.youtubeVideo].filter(v => v !== null).length === 1;
  });

  staged.orphans = orphans;

  if (orphans.length === 0) {
    state.merged = staged.merged;
    showReport();
    return;
  }

  renderOrphanTable(orphans);
  document.getElementById('fuzzy-section').style.display = 'none';
  document.getElementById('orphan-section').style.display = 'block';
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function renderOrphanTable(orphans) {
  const sorted = [...orphans].sort((a,b) => b.total - a.total);
  const tbody = document.getElementById('orphan-tbody');
  tbody.innerHTML = sorted.map((d) => {
    let platform, pillClass, playValue;
    if (d.apple !== null) { platform = 'Apple'; pillClass = 'apple'; playValue = d.apple; }
    else if (d.spotify !== null) { platform = 'Spotify'; pillClass = 'spotify'; playValue = d.spotify; }
    else if (d.youtubePodcast !== null) { platform = 'YouTube Podcast 版'; pillClass = 'yt'; playValue = d.youtubePodcast; }
    else { platform = 'YouTube 影音版'; pillClass = 'yt'; playValue = d.youtubeVideo; }

    return `
      <tr>
        <td><input type="checkbox" class="orphan-cb" data-key="${escapeAttr(d._key)}" checked></td>
        <td class="episode-title">${escapeHtml(d.title)}</td>
        <td><span class="platform-pill ${pillClass}">${platform}</span></td>
        <td class="num">${num(playValue)}</td>
        <td>${formatDate(d.dateObj)}</td>
      </tr>
    `;
  }).join('');

  document.querySelectorAll('.orphan-cb').forEach(cb => {
    cb.addEventListener('change', updateOrphanCounter);
  });
  updateOrphanCounter();
}

function toggleAllOrphans(checked) {
  document.querySelectorAll('.orphan-cb').forEach(cb => cb.checked = checked);
  document.querySelectorAll('#orphan-tbody tr').forEach(tr => {
    tr.classList.toggle('unchecked', !checked);
  });
  updateOrphanCounter();
}

function updateOrphanCounter() {
  const all = document.querySelectorAll('.orphan-cb');
  const checked = document.querySelectorAll('.orphan-cb:checked');
  document.getElementById('orphan-counter').textContent = `${checked.length} / ${all.length}`;
  document.querySelectorAll('#orphan-tbody tr').forEach(tr => {
    const cb = tr.querySelector('.orphan-cb');
    if (cb) tr.classList.toggle('unchecked', !cb.checked);
  });
}

function generateReport() {
  const excludedKeys = new Set();
  document.querySelectorAll('.orphan-cb:not(:checked)').forEach(cb => {
    excludedKeys.add(cb.dataset.key);
  });
  state.merged = staged.merged.filter(d => !excludedKeys.has(d._key));
  showReport();
}

function showReport() {
  const showName = document.getElementById('show-name').value.trim();
  renderReport(showName, state.merged);
  document.getElementById('upload-section').style.display = 'none';
  document.getElementById('ytrole-section').style.display = 'none';
  document.getElementById('fuzzy-section').style.display = 'none';
  document.getElementById('orphan-section').style.display = 'none';
  document.getElementById('report').classList.add('active');
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// ============================================================
// 7. 標題正規化與比對工具
// ============================================================
function normalizeTitle(s) {
  if (!s) return '';
  return s
    .replace(/\s+/g, '')
    .replace(/[\|｜]/g, '|')
    .replace(/[【】\[\]『』「」]/g, '')
    .replace(/[!?。,、:;!?,.:;]/g, '')
    .replace(/\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}/g, '')
    .replace(EP_STRIP_PATTERN, '')
    .replace(/[#＃][^\s|]+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .toLowerCase()
    .trim();
}

function titleKey(s, length = 15) {
  return normalizeTitle(s).slice(0, length);
}

function titleTokens(s) {
  const norm = normalizeTitle(s);
  const tokens = new Set();
  (norm.match(/\d{3,5}[a-z]?/gi) || []).forEach(t => tokens.add(t.toLowerCase()));
  for (let i = 0; i < norm.length - 1; i++) {
    const c = norm[i];
    if (/[一-龥]/.test(c)) {
      const seg2 = norm.slice(i, i+2);
      if (/^[一-龥]{2}$/.test(seg2)) tokens.add(seg2);
    }
  }
  (norm.match(/[a-z]{3,}/gi) || []).forEach(t => tokens.add(t.toLowerCase()));
  return tokens;
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersect = 0;
  for (const t of setA) if (setB.has(t)) intersect++;
  return intersect / (setA.size + setB.size - intersect);
}

function parseDate(s) {
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d)) return d;
  d = new Date(s.replace(/,/g, ''));
  if (!isNaN(d)) return d;
  return null;
}

function dateDiffDays(a, b) {
  if (!a || !b) return Infinity;
  return Math.round(Math.abs((a - b) / 86400000));
}

function formatDate(d) {
  if (!d) return '—';
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function num(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('zh-TW');
}

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n) + '…' : s;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

// ============================================================
// 8. 第一輪合併:key 比對
// ============================================================
// yt 參數是已經做過跨版本配對的組合列(每列可能同時有 youtubePodcast/youtubeVideo,
// 或只有其中一個),不是原始平台資料。
// entry.dateObj =「上線日」,用該集任一來源最早取得的日期(apple > spotify > youtube
// 依處理順序,apple 存在時優先),不特別以哪個平台為「可信基準」(FR-21,維護者定案:
// 查證確認 Apple/Spotify/YouTube 四個來源的日期都可能有 ±1 天誤差,沒有一個天生準,
// 沒理由讓 Apple 跟其他來源不同待遇)。「上線日」欄位旁邊有已知誤差的提示文字,
// 見 renderTable 表頭。
function mergeFirstPass(apple, spotify, yt) {
  [apple, spotify, yt].forEach(arr => arr.forEach(item => {
    item.tokens = titleTokens(item.title);
    item.dateObj = parseDate(item.releaseDate);
  }));

  const map = new Map();

  function addByKey(items, platform) {
    items.forEach(item => {
      const key = titleKey(item.title);
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, {
          _key: key,
          title: item.title,
          releaseDate: item.releaseDate,
          dateObj: item.dateObj,
          apple: null, spotify: null, youtubePodcast: null, youtubeVideo: null,
          tokens: item.tokens,
        });
      }
      const entry = map.get(key);
      entry[platform] = item.plays;
      if (platform === 'apple') {
        entry.title = item.title;
        entry.releaseDate = item.releaseDate;
        entry.dateObj = item.dateObj;
        entry.tokens = item.tokens;
      } else if (platform === 'spotify' && !apple.some(a => titleKey(a.title) === key)) {
        entry.title = item.title;
      }
    });
  }

  addByKey(apple, 'apple');
  addByKey(spotify, 'spotify');

  // YouTube(已合併 Podcast 版＋影音版,或單一來源)一次要寫入兩個欄位,
  // 不是單一 plays 數字,所以用專門的合併邏輯,不套用泛用的 addByKey。
  yt.forEach(item => {
    const key = titleKey(item.title);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        _key: key,
        title: item.title,
        releaseDate: item.releaseDate,
        dateObj: item.dateObj,
        apple: null, spotify: null, youtubePodcast: null, youtubeVideo: null,
        tokens: item.tokens,
      });
    }
    const entry = map.get(key);
    entry.youtubePodcast = item.youtubePodcast;
    entry.youtubeVideo = item.youtubeVideo;
    if (item.ytVideoOriginalTitle) entry._ytVideoOriginalTitle = item.ytVideoOriginalTitle;
  });

  return Array.from(map.values());
}

// ============================================================
// 9. 第二輪:找出可疑配對(不合併,列出讓使用者確認)
// ============================================================
// 泛化成同時處理「跨平台孤兒」(apple/spotify vs YouTube)與「跨版本孤兒」
// (YouTube Podcast 版 vs 影音版)。兩者用同一套相似度演算法,差別只在日期視窗:
// 跨平台維持原本 3 天限制;兩邊都是 YouTube 孤兒時放寬(影音版可能晚幾個月上架)。
function findFuzzyPairs(merged) {
  const CROSS_PLATFORM_DATE_WINDOW = 3;
  const SIM_THRESHOLD = 0.25;
  const AMBIGUOUS_MARGIN = 0.08;
  const pairs = [];
  const usedKeys = new Set();

  const SINGLE_PLATFORMS = ['apple', 'spotify', 'youtubePodcast', 'youtubeVideo'];
  function activePlatforms(e) { return SINGLE_PLATFORMS.filter(p => e[p] !== null); }
  function isOrphan(e) { return activePlatforms(e).length === 1; }
  function getPlatform(e) { return activePlatforms(e)[0]; }
  function isYtPlatform(p) { return p === 'youtubePodcast' || p === 'youtubeVideo'; }

  for (let i = 0; i < merged.length; i++) {
    const entryA = merged[i];
    if (usedKeys.has(entryA._key) || !isOrphan(entryA)) continue;
    const pA = getPlatform(entryA);
    const aIsYt = isYtPlatform(pA);

    let best = null, bestSim = SIM_THRESHOLD, second = null;

    for (let j = 0; j < merged.length; j++) {
      if (i === j) continue;
      const entryB = merged[j];
      if (usedKeys.has(entryB._key)) continue;
      if (entryB[pA] !== null) continue; // 對方必須缺孤兒的那個欄位

      const bIsOrphanYt = isOrphan(entryB) && isYtPlatform(getPlatform(entryB));
      const bothYt = aIsYt && bIsOrphanYt;
      if (!bothYt && dateDiffDays(entryA.dateObj, entryB.dateObj) > CROSS_PLATFORM_DATE_WINDOW) continue;

      const sim = jaccardSimilarity(entryA.tokens, entryB.tokens);
      if (sim > bestSim) {
        second = best ? { sim: bestSim } : null;
        best = entryB;
        bestSim = sim;
      } else if (sim > SIM_THRESHOLD && (!second || sim > second.sim)) {
        second = { sim };
      }
    }

    if (best) {
      const ambiguous = aIsYt && second && (bestSim - second.sim) < AMBIGUOUS_MARGIN;
      pairs.push({ target: entryA, match: best, sim: bestSim, ambiguous: !!ambiguous, defaultChecked: !ambiguous });
      usedKeys.add(entryA._key);
      usedKeys.add(best._key);
    }
  }

  return pairs;
}

// ============================================================
// 10. 渲染報表
// ============================================================
function renderReport(showName, data) {
  document.getElementById('report-title').textContent = showName
    ? `數據摘要：${showName}`
    : '數據摘要';

  const producer = document.getElementById('producer-name').value.trim();
  const producerLine = document.getElementById('report-producer-line');
  if (producer) {
    document.getElementById('report-producer').textContent = producer;
    producerLine.style.display = 'grid';
  } else {
    producerLine.style.display = 'none';
  }

  const dateFrom = parseDate(document.getElementById('date-from').value);
  const dateTo = parseDate(document.getElementById('date-to').value);
  if (dateFrom && dateTo) {
    document.getElementById('report-date-range').textContent =
      `${formatDate(dateFrom)} — ${formatDate(dateTo)}`;
  } else {
    document.getElementById('report-date-range').textContent = '全部集數';
  }

  const periodPlays = data.reduce((s, d) => s + d.total, 0);
  const episodes = data.length;

  const shortsThreshold = parseInt(document.getElementById('shorts-threshold').value) || 180;
  const allApple = state.apple || [];
  const allSpotify = state.spotify || [];
  const allPodcastRaw = (state.ytPodcastRows || []).filter(r => r.duration >= shortsThreshold);
  const allVideoRaw = (state.ytVideoRows || []).filter(r => r.duration >= shortsThreshold);

  let allYtCombined;
  if (state.hasVideoSource) {
    const { matched, remainP, remainV } = matchYtByEpisodeNumber(allPodcastRaw, allVideoRaw);
    allYtCombined = [];
    matched.forEach(({ p, v }) => allYtCombined.push(makeYtCombinedItem(p, v, 'matched_auto', 1)));
    remainP.forEach(p => allYtCombined.push(makeYtCombinedItem(p, null, 'unmatched', null)));
    remainV.forEach(v => allYtCombined.push(makeYtCombinedItem(null, v, 'unmatched', null)));
  } else {
    allYtCombined = allPodcastRaw.map(p => makeYtCombinedItem(p, null, null, null));
  }
  const allMerged = mergeFirstPass(allApple, allSpotify, allYtCombined);

  const rowTotal = d => (d.apple || 0) + (d.spotify || 0) + (d.youtubePodcast || 0) + (d.youtubeVideo || 0);

  const allTimePlays = allMerged.reduce((s, d) => s + rowTotal(d), 0);

  // 開播至今單集平均(v12):基準只計入「本次上傳的所有來源都有數據」的集數。
  // approvedFuzzy 記錄使用者確認過的配對(_key 跨資料集穩定),重套一次避免
  // 標題不同的集數被誤判成「缺資料」。
  const byKey = new Map(allMerged.map(d => [d._key, d]));
  const absorbedKeys = new Set();
  (state.approvedFuzzy || []).forEach(r => {
    const target = byKey.get(r.targetKey);
    const match = byKey.get(r.matchKey);
    if (target && match && match[r.platform] === null && target[r.platform] !== null) {
      match[r.platform] = target[r.platform];
      absorbedKeys.add(r.targetKey);
    }
  });
  const allMergedReviewed = allMerged.filter(d => !absorbedKeys.has(d._key));

  const uploadedPlatforms = ['apple', 'spotify'].filter(p => state[p] && state[p].length > 0);
  if (state.ytPodcastRows && state.ytPodcastRows.length > 0) uploadedPlatforms.push('youtubePodcast');
  if (state.hasVideoSource && state.ytVideoRows && state.ytVideoRows.length > 0) uploadedPlatforms.push('youtubeVideo');

  const completeRows = allMergedReviewed.filter(d => uploadedPlatforms.every(p => d[p] !== null));
  state.allTimeAvg = completeRows.length > 0
    ? Math.round(completeRows.reduce((s, d) => s + rowTotal(d), 0) / completeRows.length)
    : 0;
  state.allTimeAvgCount = completeRows.length;
  state.uploadedPlatforms = uploadedPlatforms;

  state.allTimeTop10 = [...allMergedReviewed]
    .sort((a, b) => rowTotal(b) - rowTotal(a))
    .slice(0, 10)
    .map(d => ({ title: d.title, apple: d.apple, spotify: d.spotify, youtubePodcast: d.youtubePodcast, youtubeVideo: d.youtubeVideo }));

  const now = new Date();
  const lastMonthFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthLast = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const lastMonthLabel = `${lastMonthFirst.getFullYear()}/${String(lastMonthFirst.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthPlays = allMergedReviewed.reduce((s, d) => {
    const dt = d.dateObj;
    if (dt && dt >= lastMonthFirst && dt <= lastMonthLast) return s + rowTotal(d);
    return s;
  }, 0);

  document.getElementById('sum-episodes').textContent = num(episodes);
  document.getElementById('sum-alltime').textContent = num(allTimePlays);
  document.getElementById('sum-lastmonth').textContent = num(lastMonthPlays);
  document.getElementById('sum-lastmonth-label').textContent = `${lastMonthLabel} 上架集數`;
  document.getElementById('sum-period').textContent = num(periodPlays);

  applyVideoSourceUI();
  renderSubscribers();
  renderInsights(data);
  renderMatchSummary(data);
  renderCharts(data);
  renderTable(data);
}

// FR-14:有影音版才多顯示一欄/一份說明文字,沒有影音版時維持原本三來源版面,
// 不永久多出空欄。這裡統一切換 CSS class,表格/文案在各自 render 函式內讀這個旗標。
function applyVideoSourceUI() {
  const table = document.getElementById('data-table');
  if (table) table.classList.toggle('has-video-source', !!state.hasVideoSource);

  const ytHeadLabel = document.getElementById('th-yt-label');
  if (ytHeadLabel) {
    ytHeadLabel.innerHTML = state.hasVideoSource
      ? 'YouTube<br>至今收聽'
      : 'YouTube<br>至今收聽';
  }
  const totalHeadLabel = document.getElementById('th-total-label');
  if (totalHeadLabel) {
    totalHeadLabel.innerHTML = state.hasVideoSource ? '全來源<br>總計' : '全平台<br>總計';
  }
  const totalTip = document.getElementById('th-total-tip');
  if (totalTip) {
    totalTip.setAttribute('data-tip', state.hasVideoSource
      ? 'Apple＋Spotify＋YouTube Podcast 版＋YouTube 影音版相加，參考用。各來源計算邏輯不同、同一人可能重複計算，不是精準總人次。'
      : '三平台相加，參考用。三平台計算邏輯不同、同一人可能重複計算，不是精準總人次。');
  }

  const shortsNote = document.getElementById('shorts-excluded-note');
  if (shortsNote) {
    shortsNote.textContent = state.excludedShortsCount
      ? `本次已排除 ${state.excludedShortsCount} 支低於門檻的短片(Shorts)`
      : '';
  }
}

function renderSubscribers() {
  const subApple = document.getElementById('sub-apple').value.trim();
  const subSpotify = document.getElementById('sub-spotify').value.trim();
  const subYt = document.getElementById('sub-yt').value.trim();

  const hasAny = subApple || subSpotify || subYt;
  const subDisplay = document.getElementById('subscriber-display');

  if (!hasAny) {
    subDisplay.style.display = 'none';
    return;
  }

  subDisplay.style.display = 'flex';

  function setVal(elId, val) {
    const el = document.getElementById(elId);
    if (val) {
      const n = parseInt(val.replace(/[,，\s]/g, ''));
      el.textContent = isNaN(n) ? val : num(n);
      el.classList.remove('empty');
    } else {
      el.textContent = '未填';
      el.classList.add('empty');
    }
  }
  setVal('disp-sub-apple', subApple);
  setVal('disp-sub-spotify', subSpotify);
  setVal('disp-sub-yt', subYt);
}

function renderInsights(data) {
  const insights = [];

  const appleTotal = data.reduce((s, d) => s + (d.apple || 0), 0);
  const spotifyTotal = data.reduce((s, d) => s + (d.spotify || 0), 0);
  const ytPodcastTotal = data.reduce((s, d) => s + (d.youtubePodcast || 0), 0);
  const ytVideoTotal = data.reduce((s, d) => s + (d.youtubeVideo || 0), 0);
  const ytTotal = ytPodcastTotal + ytVideoTotal;
  const grand = appleTotal + spotifyTotal + ytTotal;
  const avg = data.length > 0 ? Math.round(grand / data.length) : 0;

  const shares = [
    { name: 'Apple Podcast', val: appleTotal },
    { name: 'Spotify', val: spotifyTotal },
    { name: 'YouTube', val: ytTotal },
  ].sort((a, b) => b.val - a.val);
  const topShare = grand > 0 ? (shares[0].val / grand) * 100 : 0;

  if (topShare > 50) {
    insights.push(`<strong>流量高度集中在 ${shares[0].name}</strong>(佔 ${topShare.toFixed(1)}%)。其他來源合計僅 ${(100-topShare).toFixed(1)}%,可考慮加強較弱來源的露出。`);
  } else if (topShare < 40 && grand > 0) {
    insights.push(`<strong>各來源分布均衡</strong>,最大來源 ${shares[0].name} 也只佔 ${topShare.toFixed(1)}%。代表節目在各來源都有穩定觸及,沒有特別偏重單一來源。`);
  } else if (grand > 0) {
    insights.push(`主要流量來源是 <strong>${shares[0].name}</strong>(${topShare.toFixed(1)}%),其次為 ${shares[1].name}(${((shares[1].val/grand)*100).toFixed(1)}%)。`);
  }

  const top = data.reduce((m, d) => d.total > (m?.total || 0) ? d : m, null);
  if (top && avg > 0 && top.total > avg * 2) {
    const platformContrib = [
      { name: 'Apple', val: top.apple || 0 },
      { name: 'Spotify', val: top.spotify || 0 },
      { name: state.hasVideoSource ? 'YouTube Podcast 版' : 'YouTube', val: top.youtubePodcast || 0 },
    ];
    if (state.hasVideoSource) platformContrib.push({ name: 'YouTube 影音版', val: top.youtubeVideo || 0 });
    platformContrib.sort((a, b) => b.val - a.val);
    const topPct = ((platformContrib[0].val / top.total) * 100).toFixed(0);
    insights.push(`<strong>最高單集「${escapeHtml(truncate(top.title, 30))}」</strong>達 ${num(top.total)} 次,是單集平均(${num(avg)})的 ${(top.total/avg).toFixed(1)} 倍。主要由 ${platformContrib[0].name} 貢獻(${topPct}%),建議分析該集在該來源的成功原因(標題、選題、上線時機)。`);
  }

  const podcastTotal = appleTotal + spotifyTotal;
  if (ytTotal > 0 && podcastTotal > 0) {
    const ytRatio = ytTotal / podcastTotal;
    if (ytRatio > 0.8) {
      insights.push(`<strong>YouTube 累積(${num(ytTotal)})已接近甚至超過 Podcast 雙平台合計(${num(podcastTotal)})</strong>,YouTube 是這個節目重要的流量來源。`);
    } else if (ytRatio < 0.3) {
      insights.push(`YouTube 累積(${num(ytTotal)})為 Podcast 雙平台合計(${num(podcastTotal)})的 ${(ytRatio*100).toFixed(0)}%。`);
    }
  }

  document.getElementById('insights-list').innerHTML = insights.map(i => `<li>${i}</li>`).join('');
}

function renderMatchSummary(data) {
  const hasVideo = state.hasVideoSource;
  const allComplete = data.filter(d =>
    d.apple !== null && d.spotify !== null && d.youtubePodcast !== null && (!hasVideo || d.youtubeVideo !== null)
  ).length;
  const apple = data.filter(d => d.apple !== null).length;
  const spotify = data.filter(d => d.spotify !== null).length;
  const ytPodcast = data.filter(d => d.youtubePodcast !== null).length;
  const ytVideo = data.filter(d => d.youtubeVideo !== null).length;
  const fuzzy = data.filter(d => d._fuzzyMatched).length;

  let html = `
    <div class="match-stat"><span>${hasVideo ? '四來源都有' : '三平台都有'}</span><strong>${allComplete}</strong></div>
    <div class="match-stat"><span>Apple 有資料</span><strong>${apple}</strong></div>
    <div class="match-stat"><span>Spotify 有資料</span><strong>${spotify}</strong></div>
    <div class="match-stat"><span>${hasVideo ? 'YouTube Podcast 版有資料' : 'YouTube 有資料'}</span><strong>${ytPodcast}</strong></div>`;
  if (hasVideo) {
    html += `<div class="match-stat"><span>YouTube 影音版有資料</span><strong>${ytVideo}</strong></div>`;
  }
  html += `
    <div class="match-stat"><span>單集總數</span><strong>${data.length}</strong></div>
    ${fuzzy > 0 ? `<div class="match-stat"><span>後備比對成功</span><strong>${fuzzy}</strong></div>` : ''}
    <div class="match-stat"><span>開播至今單集平均</span><strong>${num(state.allTimeAvg)}</strong></div>
  `;
  document.getElementById('match-summary').innerHTML = html;
}

// ============================================================
// 10. 圖表
// ============================================================
function renderCharts(data) {
  Object.values(charts).forEach(c => c && c.destroy());

  Chart.defaults.font.family = "'Noto Sans TC', sans-serif";
  Chart.defaults.color = '#444';
  Chart.defaults.font.size = 12;

  // 色碼一律六位數:程式會在色碼後面接兩位透明度(如 + '20'),
  // 三位數會接出無效色(YouTube 圖例曾因此變黑塊,見 CLAUDE.md 地雷區)。
  const PALETTE = { apple: '#c8341a', spotify: '#1d9b54', youtubePodcast: '#555555', youtubeVideo: '#9a9a9a' };
  const hasVideo = state.hasVideoSource;

  // 長條圖不論類目(集數)多少,粗細都固定,避免項目少時單一長條被撐得肥大
  const BAR_THICKNESS = 26;

  function buildDatasets(rows, valueOf, forBar) {
    const ds = [
      { label: 'Apple', data: rows.map(d => forBar ? (valueOf(d, 'apple') || 0) : valueOf(d, 'apple')), backgroundColor: PALETTE.apple, borderColor: PALETTE.apple, ...(forBar ? { maxBarThickness: BAR_THICKNESS } : { backgroundColor: PALETTE.apple + '20', tension: 0.3, spanGaps: true }) },
      { label: 'Spotify', data: rows.map(d => forBar ? (valueOf(d, 'spotify') || 0) : valueOf(d, 'spotify')), backgroundColor: PALETTE.spotify, borderColor: PALETTE.spotify, ...(forBar ? { maxBarThickness: BAR_THICKNESS } : { backgroundColor: PALETTE.spotify + '20', tension: 0.3, spanGaps: true }) },
      { label: hasVideo ? 'YouTube Podcast 版' : 'YouTube', data: rows.map(d => forBar ? (valueOf(d, 'youtubePodcast') || 0) : valueOf(d, 'youtubePodcast')), backgroundColor: PALETTE.youtubePodcast, borderColor: PALETTE.youtubePodcast, ...(forBar ? { maxBarThickness: BAR_THICKNESS } : { backgroundColor: PALETTE.youtubePodcast + '20', tension: 0.3, spanGaps: true }) },
    ];
    if (hasVideo) {
      ds.push({ label: 'YouTube 影音版', data: rows.map(d => forBar ? (valueOf(d, 'youtubeVideo') || 0) : valueOf(d, 'youtubeVideo')), backgroundColor: PALETTE.youtubeVideo, borderColor: PALETTE.youtubeVideo, ...(forBar ? { maxBarThickness: BAR_THICKNESS } : { backgroundColor: PALETTE.youtubeVideo + '20', tension: 0.3, spanGaps: true }) });
    }
    return ds;
  }

  const sorted = [...data].filter(d => d.dateObj).sort((a, b) => a.dateObj - b.dateObj);
  charts.trend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: {
      labels: sorted.map(d => formatDate(d.dateObj)),
      datasets: buildDatasets(sorted, (d, p) => d[p], false),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: {
          // 圖例改實心色塊,與排行榜圖一致(線圖預設是框線+半透明填色,兩張圖並列不一致)
          generateLabels(chart) {
            const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
            items.forEach(it => {
              const c = chart.data.datasets[it.datasetIndex].borderColor;
              it.fillStyle = c;
              it.strokeStyle = c;
            });
            return items;
          }
        } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              return `${formatDate(sorted[idx].dateObj)} · ${truncate(sorted[idx].title, 30)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 12 } },
        y: { beginAtZero: true, grid: { color: '#e5dec9' } }
      }
    }
  });

  // 標題被 truncate 成短版顯示在 y 軸,hover 長條時 tooltip 標題顯示完整原始標題(修正:標題截斷看不到完整內容)
  function makeBarOptions(rows) {
    return {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', align: 'start' },
        tooltip: { callbacks: { title: (items) => rows[items[0].dataIndex].title } }
      },
      scales: {
        x: { stacked: true, beginAtZero: true, grid: { color: '#e5dec9' }, title: { display: true, text: '次數' } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, crossAlign: 'far' } }
      }
    };
  }

  const top10 = [...data].sort((a, b) => b.total - a.total).slice(0, 10);
  charts.ranking = new Chart(document.getElementById('chart-ranking'), {
    type: 'bar',
    data: { labels: top10.map(d => truncate(d.title, 22)), datasets: buildDatasets(top10, (d, p) => d[p], true) },
    options: makeBarOptions(top10),
  });

  // 開播至今播放排行榜 TOP 10(v12):用全部資料,不受分析區間影響
  const allTop10 = state.allTimeTop10 || [];
  charts.rankingAlltime = new Chart(document.getElementById('chart-ranking-alltime'), {
    type: 'bar',
    data: { labels: allTop10.map(d => truncate(d.title, 22)), datasets: buildDatasets(allTop10, (d, p) => d[p], true) },
    options: makeBarOptions(allTop10),
  });

  const appleTotal = data.reduce((s, d) => s + (d.apple || 0), 0);
  const spotifyTotal = data.reduce((s, d) => s + (d.spotify || 0), 0);
  const ytPodcastTotal = data.reduce((s, d) => s + (d.youtubePodcast || 0), 0);
  const ytVideoTotal = hasVideo ? data.reduce((s, d) => s + (d.youtubeVideo || 0), 0) : 0;
  const grand = appleTotal + spotifyTotal + ytPodcastTotal + ytVideoTotal;

  const shareLabels = ['Apple Podcast', 'Spotify', hasVideo ? 'YouTube Podcast 版' : 'YouTube'];
  const shareData = [appleTotal, spotifyTotal, ytPodcastTotal];
  const shareColors = [PALETTE.apple, PALETTE.spotify, PALETTE.youtubePodcast];
  if (hasVideo) { shareLabels.push('YouTube 影音版'); shareData.push(ytVideoTotal); shareColors.push(PALETTE.youtubeVideo); }

  charts.share = new Chart(document.getElementById('chart-share'), {
    type: 'doughnut',
    data: {
      labels: shareLabels,
      datasets: [{ data: shareData, backgroundColor: shareColors, borderColor: '#f5f1ea', borderWidth: 3 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = grand > 0 ? ((ctx.parsed / grand) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${num(ctx.parsed)} 次 (${pct}%)`;
            }
          }
        }
      },
      cutout: '62%',
    },
    plugins: [{
      id: 'centerText',
      beforeDraw(chart) {
        const { ctx, chartArea: { left, right, top, bottom } } = chart;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#888';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText('TOTAL', cx, cy - 18);
        ctx.fillStyle = '#1a1a1a';
        ctx.font = '600 22px "Noto Serif TC", serif';
        ctx.fillText(num(grand) + ' 次', cx, cy + 2);
        ctx.fillStyle = '#888';
        ctx.font = '11px "Noto Sans TC", sans-serif';
        ctx.fillText(hasVideo ? '四來源累積' : '三平台累積', cx, cy + 22);
        ctx.restore();
      }
    }]
  });

  const shareLegend = document.getElementById('share-legend');
  if (shareLegend) {
    const items = shareLabels.map((name, i) => ({ name, val: shareData[i], color: shareColors[i] }));
    shareLegend.innerHTML = items.map(it => {
      const pct = grand > 0 ? ((it.val / grand) * 100).toFixed(1) : 0;
      return `
        <div class="legend-row">
          <span class="legend-dot" style="background:${it.color}"></span>
          <span class="legend-name">${it.name}</span>
          <span class="legend-val">${num(it.val)} 次</span>
          <span class="legend-pct">${pct}%</span>
        </div>
      `;
    }).join('');
  }
}

// ============================================================
// 11. 表格(排序 + 搜尋)
// ============================================================

// 「收聽平均比較」欄(v12):該集全部已上傳來源總計 vs 開播至今單集平均。
// 高於平均=紅色箭頭朝上、低於=綠色箭頭朝下(台股慣例:紅漲綠跌)。
// 缺任一已上傳來源數據的集數不參與比較(顯示 —),因為它的總計天生偏低,比了不公平。
function cmpToAvgHtml(d) {
  const avg = state.allTimeAvg || 0;
  const platforms = state.uploadedPlatforms || [];
  if (!avg || platforms.length === 0) return '—';
  const complete = platforms.every(p => d[p] !== null);
  if (!complete) return '—';
  const diffPct = ((d.total - avg) / avg) * 100;
  if (d.total > avg) return `<span class="cmp-avg up">▲ +${diffPct.toFixed(0)}%</span>`;
  if (d.total < avg) return `<span class="cmp-avg down">▼ ${diffPct.toFixed(0)}%</span>`;
  return '<span class="cmp-avg">持平</span>';
}
function renderTable(allData) {
  const hasVideo = state.hasVideoSource;
  // 套用搜尋:用空格分隔多個關鍵字,符合任一個就顯示(OR)。
  let data = allData;
  if (state.searchQuery) {
    const terms = state.searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
      data = allData.filter(d => {
        const title = d.title.toLowerCase();
        const ytTitle = d._ytOriginalTitle ? d._ytOriginalTitle.toLowerCase() : '';
        const ytVideoTitle = d._ytVideoOriginalTitle ? d._ytVideoOriginalTitle.toLowerCase() : '';
        return terms.some(t => title.includes(t) || ytTitle.includes(t) || ytVideoTitle.includes(t));
      });
    }
  }

  // 計算「上一週」的起點:上一個完整週的週一(0:00)
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const dow = today.getDay() === 0 ? 7 : today.getDay();
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - (dow - 1));
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  lastMonday.setHours(0, 0, 0, 0);
  function isRecentWeek(dateObj) {
    if (!dateObj) return false;
    return dateObj.getTime() >= lastMonday.getTime() && dateObj.getTime() <= today.getTime();
  }

  // 套用排序
  const sorted = [...data].sort((a, b) => {
    let av, bv;
    switch (state.sortBy) {
      case 'date': av = a.dateObj ? a.dateObj.getTime() : 0; bv = b.dateObj ? b.dateObj.getTime() : 0; break;
      case 'apple': av = a.apple ?? -1; bv = b.apple ?? -1; break;
      case 'spotify': av = a.spotify ?? -1; bv = b.spotify ?? -1; break;
      case 'youtubePodcast': av = a.youtubePodcast ?? -1; bv = b.youtubePodcast ?? -1; break;
      case 'youtubeVideo': av = a.youtubeVideo ?? -1; bv = b.youtubeVideo ?? -1; break;
      case 'total': av = a.total; bv = b.total; break;
      default: av = 0; bv = 0;
    }
    return state.sortDir === 'desc' ? bv - av : av - bv;
  });

  const tbody = document.getElementById('data-tbody');
  tbody.innerHTML = sorted.map(d => {
    const missing = [];
    if (d.apple === null) missing.push('Apple');
    if (d.spotify === null) missing.push('Spotify');
    if (d.youtubePodcast === null) missing.push(hasVideo ? 'YouTube Podcast 版' : 'YouTube');
    if (hasVideo && d.youtubeVideo === null) missing.push('YouTube 影音版');
    let note = missing.length > 0 ? `<span class="tag missing">缺 ${missing.join('、')}</span>` : '';
    if (d._ytOriginalTitle) {
      note += `<span class="tag" style="background:rgba(244,226,133,0.5);color:#7a5d00;border:none;" title="${escapeAttr(d._ytOriginalTitle)}">YouTube 標題不同</span>`;
    }
    if (hasVideo && d._ytVideoOriginalTitle) {
      note += `<span class="tag" style="background:rgba(244,226,133,0.5);color:#7a5d00;border:none;" title="${escapeAttr(d._ytVideoOriginalTitle)}">影音版標題不同</span>`;
    }
    const savedNote = state.notes[d._key] || '';
    const noteCell = `
      ${note ? `<div class="note-tags">${note}</div>` : ''}
      <textarea class="note-input" data-key="${escapeAttr(d._key)}" rows="1" placeholder="可填備註…">${escapeHtml(savedNote)}</textarea>
    `;

    const recentClass = isRecentWeek(d.dateObj) ? ' class="recent-week"' : '';
    return `
      <tr${recentClass}>
        <td>${formatDate(d.dateObj)}</td>
        <td class="episode-title">
          ${escapeHtml(d.title)}
        </td>
        <td class="num platform-apple">${num(d.apple)}</td>
        <td class="num platform-spotify">${num(d.spotify)}</td>
        <td class="num platform-yt">${num(d.youtubePodcast)}</td>
        ${hasVideo ? `<td class="num platform-yt yt-video-col">${num(d.youtubeVideo)}</td>` : ''}
        <td class="num"><strong>${num(d.total)}</strong></td>
        <td class="cmp-cell">${cmpToAvgHtml(d)}</td>
        <td class="note-cell">${noteCell}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.note-input').forEach(ta => {
    const autoGrow = () => {
      if (!ta.value) { ta.style.height = ''; return; }
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    };
    autoGrow();
    ta.addEventListener('input', () => {
      const key = ta.dataset.key;
      const v = ta.value;
      if (v.trim()) state.notes[key] = v;
      else delete state.notes[key];
      autoGrow();
    });
  });

  document.querySelectorAll('#data-table th.sortable').forEach(th => {
    const col = th.dataset.sort;
    th.classList.remove('sort-asc', 'sort-desc');
    if (col === state.sortBy) th.classList.add(state.sortDir === 'desc' ? 'sort-desc' : 'sort-asc');
  });

  const countEl = document.getElementById('search-count');
  if (countEl) {
    if (state.searchQuery) {
      countEl.textContent = `找到 ${sorted.length} / ${allData.length} 集`;
    } else {
      countEl.textContent = `共 ${allData.length} 集`;
    }
  }
}

document.querySelectorAll('#data-table th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (state.sortBy === col) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    else { state.sortBy = col; state.sortDir = 'desc'; }
    renderTable(state.merged);
  });
});

const searchInput = document.getElementById('table-search');
const searchWrap = searchInput?.parentElement;
const searchClear = document.getElementById('search-clear');

if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    searchWrap.classList.toggle('has-text', !!state.searchQuery);
    if (state.merged) renderTable(state.merged);
  });
}
if (searchClear) {
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    searchWrap.classList.remove('has-text');
    if (state.merged) renderTable(state.merged);
  });
}

// ============================================================
// 12. 匯出獨立 HTML
// ============================================================
document.getElementById('btn-print').addEventListener('click', () => window.print());
document.getElementById('btn-export-html').addEventListener('click', exportStandaloneHTML);

async function exportStandaloneHTML() {
  if (!state.merged) return;
  const hasVideo = state.hasVideoSource;

  const showName = document.getElementById('show-name').value.trim() || '節目';
  const producer = document.getElementById('producer-name').value.trim();
  const today = localDateStr();
  const _now = new Date();
  const exportTimeStr = `${localDateStr(_now).replace(/-/g, '/')} ${String(_now.getHours()).padStart(2,'0')}:${String(_now.getMinutes()).padStart(2,'0')}`;

  let chartJsCode = '';
  try {
    const resp = await fetch('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js');
    chartJsCode = await resp.text();
  } catch (e) {
    console.warn('Chart.js fetch failed, fallback to CDN', e);
  }

  const _today = new Date();
  _today.setHours(23, 59, 59, 999);
  const _dow = _today.getDay() === 0 ? 7 : _today.getDay();
  const _thisMon = new Date(_today);
  _thisMon.setDate(_today.getDate() - (_dow - 1));
  const _lastMon = new Date(_thisMon);
  _lastMon.setDate(_thisMon.getDate() - 7);
  _lastMon.setHours(0, 0, 0, 0);
  function _isRecentWeek(dObj) {
    if (!dObj) return false;
    return dObj.getTime() >= _lastMon.getTime() && dObj.getTime() <= _today.getTime();
  }

  const dataToEmbed = state.merged.map(d => ({
    title: d.title,
    releaseDate: d.releaseDate,
    dateISO: d.dateObj ? d.dateObj.toISOString() : null,
    apple: d.apple,
    spotify: d.spotify,
    youtubePodcast: d.youtubePodcast,
    youtubeVideo: hasVideo ? d.youtubeVideo : null,
    total: d.total,
    fuzzy: !!d._fuzzyMatched,
    ytOriginalTitle: d._ytOriginalTitle || null,
    ytVideoOriginalTitle: hasVideo ? (d._ytVideoOriginalTitle || null) : null,
    recentWeek: _isRecentWeek(d.dateObj),
    note: (state.notes[d._key] || '').trim() || null,
    complete: (state.uploadedPlatforms || []).length > 0 &&
      state.uploadedPlatforms.every(p => d[p] !== null),
  }));

  const alltimeToEmbed = {
    avg: state.allTimeAvg || 0,
    top10: state.allTimeTop10 || [],
  };

  const subData = {
    apple: document.getElementById('sub-apple').value.trim(),
    spotify: document.getElementById('sub-spotify').value.trim(),
    yt: document.getElementById('sub-yt').value.trim(),
  };

  const dateFrom = document.getElementById('date-from').value;
  const dateTo = document.getElementById('date-to').value;

  const styleEl = document.querySelector('style').cloneNode(true);
  const reportSection = document.getElementById('report').cloneNode(true);
  reportSection.querySelectorAll('.no-print').forEach(el => el.remove());
  reportSection.removeAttribute('id');
  reportSection.classList.add('active');
  reportSection.style.display = 'block';

  reportSection.querySelectorAll('.note-input').forEach(ta => {
    const key = ta.getAttribute('data-key');
    const val = (state.notes[key] || '').trim();
    if (val) {
      const div = document.createElement('div');
      div.className = 'note-frozen';
      div.textContent = val;
      ta.replaceWith(div);
    } else {
      ta.remove();
    }
  });

  const chartScript = chartJsCode
    ? `<script>${chartJsCode}<\/script>`
    : `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>`;

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(showName)}_收聽數據_${today}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;600;900&family=Noto+Sans+TC:wght@300;400;500;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
${chartScript}
${styleEl.outerHTML}
<style>
  body { background: var(--paper); }
  .standalone-header {
    border-bottom: 3px double var(--ink);
    padding-bottom: 28px;
    margin-bottom: 40px;
  }
  .standalone-header .top {
    display: flex; justify-content: space-between;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; letter-spacing: 0.15em;
    text-transform: uppercase; color: var(--ink-faint);
    margin-bottom: 18px;
  }
  .standalone-header h1 {
    font-family: 'Noto Serif TC', serif; font-weight: 900;
    font-size: 50px; letter-spacing: -0.02em; line-height: 1.05;
    margin-bottom: 12px;
  }
  .standalone-header .sub {
    font-family: 'Noto Serif TC', serif; font-style: italic;
    font-size: 18px; color: var(--ink-soft);
  }
  .standalone-header .sub-range {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; color: var(--ink-faint);
    margin-top: 6px; letter-spacing: 0.05em;
  }
  .standalone-footer {
    margin-top: 80px; padding-top: 24px;
    border-top: 1px solid var(--line);
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; letter-spacing: 0.1em;
    color: var(--ink-faint); text-align: center;
    line-height: 1.8;
  }
  th.sortable { cursor: pointer; }
</style>
</head>
<body>
<div class="container">
  <header class="standalone-header">
    <div class="top">
      <span>鏡好聽專用</span>
      <span>報表產出時間 ${exportTimeStr}</span>
    </div>
    <h1>RSS節目收聽<br>分析報告</h1>
  </header>
  ${reportSection.outerHTML}
  <footer class="standalone-footer">
    本報表為靜態快照,資料為產出當下的數值。<br>
    若需更新數據或進行新一輪比較,請回到工具上傳新的 CSV 重新產出。
  </footer>
</div>

<script>
const EMBEDDED_DATA = ${JSON.stringify(dataToEmbed)};
const SUB_DATA = ${JSON.stringify(subData)};
const ALLTIME = ${JSON.stringify(alltimeToEmbed)};
const HAS_VIDEO = ${JSON.stringify(hasVideo)};

const data = EMBEDDED_DATA.map(d => ({
  ...d,
  dateObj: d.dateISO ? new Date(d.dateISO) : null,
}));

// 色碼一律六位數:程式會在色碼後面接兩位透明度(如 + '20'),
// 三位數 '#555' 接出來是 '#55520' 無效色,YouTube 圖例方塊會變黑色實心(v12 修過)。
const PALETTE = { apple: '#c8341a', spotify: '#1d9b54', youtubePodcast: '#555555', youtubeVideo: '#9a9a9a' };
const BAR_THICKNESS = 26;

function num(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('zh-TW');
}
function formatDate(d) {
  if (!d) return '—';
  return d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0');
}
function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n) + '…' : s;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

function cmpToAvgHtml(d) {
  if (!ALLTIME.avg || !d.complete) return '—';
  const diffPct = ((d.total - ALLTIME.avg) / ALLTIME.avg) * 100;
  if (d.total > ALLTIME.avg) return '<span class="cmp-avg up">▲ +' + diffPct.toFixed(0) + '%</span>';
  if (d.total < ALLTIME.avg) return '<span class="cmp-avg down">▼ ' + diffPct.toFixed(0) + '%</span>';
  return '<span class="cmp-avg">持平</span>';
}

(function setSubs() {
  const wrap = document.getElementById('subscriber-display');
  if (!wrap) return;
  const hasAny = SUB_DATA.apple || SUB_DATA.spotify || SUB_DATA.yt;
  if (!hasAny) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  function setVal(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    if (val) {
      const n = parseInt(val.replace(/[,，\\s]/g, ''));
      el.textContent = isNaN(n) ? val : num(n);
      el.classList.remove('empty');
    } else {
      el.textContent = '未填';
      el.classList.add('empty');
    }
  }
  setVal('disp-sub-apple', SUB_DATA.apple);
  setVal('disp-sub-spotify', SUB_DATA.spotify);
  setVal('disp-sub-yt', SUB_DATA.yt);
})();

Chart.defaults.font.family = "'Noto Sans TC', sans-serif";
Chart.defaults.color = '#444';
Chart.defaults.font.size = 12;

function buildDatasets(rows, valueOf, forBar) {
  const ds = [
    { label: 'Apple', data: rows.map(d => forBar ? (valueOf(d, 'apple') || 0) : valueOf(d, 'apple')), backgroundColor: PALETTE.apple, borderColor: PALETTE.apple, ...(forBar ? { maxBarThickness: BAR_THICKNESS } : { backgroundColor: PALETTE.apple + '20', tension: 0.3, spanGaps: true }) },
    { label: 'Spotify', data: rows.map(d => forBar ? (valueOf(d, 'spotify') || 0) : valueOf(d, 'spotify')), backgroundColor: PALETTE.spotify, borderColor: PALETTE.spotify, ...(forBar ? { maxBarThickness: BAR_THICKNESS } : { backgroundColor: PALETTE.spotify + '20', tension: 0.3, spanGaps: true }) },
    { label: HAS_VIDEO ? 'YouTube Podcast 版' : 'YouTube', data: rows.map(d => forBar ? (valueOf(d, 'youtubePodcast') || 0) : valueOf(d, 'youtubePodcast')), backgroundColor: PALETTE.youtubePodcast, borderColor: PALETTE.youtubePodcast, ...(forBar ? { maxBarThickness: BAR_THICKNESS } : { backgroundColor: PALETTE.youtubePodcast + '20', tension: 0.3, spanGaps: true }) },
  ];
  if (HAS_VIDEO) {
    ds.push({ label: 'YouTube 影音版', data: rows.map(d => forBar ? (valueOf(d, 'youtubeVideo') || 0) : valueOf(d, 'youtubeVideo')), backgroundColor: PALETTE.youtubeVideo, borderColor: PALETTE.youtubeVideo, ...(forBar ? { maxBarThickness: BAR_THICKNESS } : { backgroundColor: PALETTE.youtubeVideo + '20', tension: 0.3, spanGaps: true }) });
  }
  return ds;
}

const sorted = [...data].filter(d => d.dateObj).sort((a, b) => a.dateObj - b.dateObj);
new Chart(document.getElementById('chart-trend'), {
  type: 'line',
  data: { labels: sorted.map(d => formatDate(d.dateObj)), datasets: buildDatasets(sorted, (d, p) => d[p], false) },
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', align: 'end', labels: {
          generateLabels(chart) {
            const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
            items.forEach(it => {
              const c = chart.data.datasets[it.datasetIndex].borderColor;
              it.fillStyle = c;
              it.strokeStyle = c;
            });
            return items;
          }
        } },
      tooltip: {
        callbacks: {
          title: (items) => {
            const idx = items[0].dataIndex;
            return formatDate(sorted[idx].dateObj) + ' · ' + truncate(sorted[idx].title, 30);
          }
        }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 12 } },
      y: { beginAtZero: true, grid: { color: '#e5dec9' } }
    }
  }
});

function makeBarOptions(rows) {
  return {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', align: 'start' },
      tooltip: { callbacks: { title: (items) => rows[items[0].dataIndex].title } }
    },
    scales: {
      x: { stacked: true, beginAtZero: true, grid: { color: '#e5dec9' }, title: { display: true, text: '次數' } },
      y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, crossAlign: 'far' } }
    }
  };
}

const top10 = [...data].sort((a, b) => b.total - a.total).slice(0, 10);
new Chart(document.getElementById('chart-ranking'), {
  type: 'bar',
  data: { labels: top10.map(d => truncate(d.title, 22)), datasets: buildDatasets(top10, (d, p) => d[p], true) },
  options: makeBarOptions(top10),
});

new Chart(document.getElementById('chart-ranking-alltime'), {
  type: 'bar',
  data: { labels: ALLTIME.top10.map(d => truncate(d.title, 22)), datasets: buildDatasets(ALLTIME.top10, (d, p) => d[p], true) },
  options: makeBarOptions(ALLTIME.top10),
});

const appleTotal = data.reduce((s, d) => s + (d.apple || 0), 0);
const spotifyTotal = data.reduce((s, d) => s + (d.spotify || 0), 0);
const ytPodcastTotal = data.reduce((s, d) => s + (d.youtubePodcast || 0), 0);
const ytVideoTotal = HAS_VIDEO ? data.reduce((s, d) => s + (d.youtubeVideo || 0), 0) : 0;
const grand = appleTotal + spotifyTotal + ytPodcastTotal + ytVideoTotal;

const shareLabels = ['Apple Podcast', 'Spotify', HAS_VIDEO ? 'YouTube Podcast 版' : 'YouTube'];
const shareData = [appleTotal, spotifyTotal, ytPodcastTotal];
const shareColors = [PALETTE.apple, PALETTE.spotify, PALETTE.youtubePodcast];
if (HAS_VIDEO) { shareLabels.push('YouTube 影音版'); shareData.push(ytVideoTotal); shareColors.push(PALETTE.youtubeVideo); }

new Chart(document.getElementById('chart-share'), {
  type: 'doughnut',
  data: { labels: shareLabels, datasets: [{ data: shareData, backgroundColor: shareColors, borderColor: '#f5f1ea', borderWidth: 3 }] },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const pct = grand > 0 ? ((ctx.parsed / grand) * 100).toFixed(1) : 0;
            return ctx.label + ': ' + num(ctx.parsed) + ' 次 (' + pct + '%)';
          }
        }
      }
    },
    cutout: '62%',
  },
  plugins: [{
    id: 'centerText',
    beforeDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom } } = chart;
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#888';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText('TOTAL', cx, cy - 18);
      ctx.fillStyle = '#1a1a1a';
      ctx.font = '600 22px "Noto Serif TC", serif';
      ctx.fillText(num(grand) + ' 次', cx, cy + 2);
      ctx.fillStyle = '#888';
      ctx.font = '11px "Noto Sans TC", sans-serif';
      ctx.fillText(HAS_VIDEO ? '四來源累積' : '三平台累積', cx, cy + 22);
      ctx.restore();
    }
  }]
});

const shareLegend = document.getElementById('share-legend');
if (shareLegend) {
  const items = shareLabels.map((name, i) => ({ name, val: shareData[i], color: shareColors[i] }));
  shareLegend.innerHTML = items.map(it => {
    const pct = grand > 0 ? ((it.val / grand) * 100).toFixed(1) : 0;
    return '<div class="legend-row">' +
      '<span class="legend-dot" style="background:' + it.color + '"></span>' +
      '<span class="legend-name">' + it.name + '</span>' +
      '<span class="legend-val">' + num(it.val) + ' 次</span>' +
      '<span class="legend-pct">' + pct + '%</span>' +
    '</div>';
  }).join('');
}

const tableState = { sortBy: 'date', sortDir: 'desc', searchQuery: '' };

function renderTable() {
  let filtered = data;
  if (tableState.searchQuery) {
    const q = tableState.searchQuery.toLowerCase();
    filtered = data.filter(d =>
      d.title.toLowerCase().includes(q) ||
      (d.ytOriginalTitle && d.ytOriginalTitle.toLowerCase().includes(q)) ||
      (d.ytVideoOriginalTitle && d.ytVideoOriginalTitle.toLowerCase().includes(q))
    );
  }
  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    switch (tableState.sortBy) {
      case 'date': av = a.dateObj ? a.dateObj.getTime() : 0; bv = b.dateObj ? b.dateObj.getTime() : 0; break;
      case 'apple': av = a.apple ?? -1; bv = b.apple ?? -1; break;
      case 'spotify': av = a.spotify ?? -1; bv = b.spotify ?? -1; break;
      case 'youtubePodcast': av = a.youtubePodcast ?? -1; bv = b.youtubePodcast ?? -1; break;
      case 'youtubeVideo': av = a.youtubeVideo ?? -1; bv = b.youtubeVideo ?? -1; break;
      case 'total': av = a.total; bv = b.total; break;
      default: av = 0; bv = 0;
    }
    return tableState.sortDir === 'desc' ? bv - av : av - bv;
  });

  const tbody = document.getElementById('data-tbody');
  tbody.innerHTML = sorted.map(d => {
    const missing = [];
    if (d.apple === null) missing.push('Apple');
    if (d.spotify === null) missing.push('Spotify');
    if (d.youtubePodcast === null) missing.push(HAS_VIDEO ? 'YouTube Podcast 版' : 'YouTube');
    if (HAS_VIDEO && d.youtubeVideo === null) missing.push('YouTube 影音版');
    let note = missing.length > 0 ? '<span class="tag missing">缺 ' + missing.join('、') + '</span>' : '';
    if (d.ytOriginalTitle) {
      note += '<span class="tag" style="background:rgba(244,226,133,0.5);color:#7a5d00;border:none;" title="' + escapeAttr(d.ytOriginalTitle) + '">YouTube 標題不同</span>';
    }
    if (HAS_VIDEO && d.ytVideoOriginalTitle) {
      note += '<span class="tag" style="background:rgba(244,226,133,0.5);color:#7a5d00;border:none;" title="' + escapeAttr(d.ytVideoOriginalTitle) + '">影音版標題不同</span>';
    }
    const noteCell =
      (note ? '<div class="note-tags">' + note + '</div>' : '') +
      (d.note ? '<div class="note-frozen">' + escapeHtml(d.note) + '</div>' : '');
    return '<tr' + (d.recentWeek ? ' class="recent-week"' : '') + '>' +
      '<td>' + formatDate(d.dateObj) + '</td>' +
      '<td class="episode-title">' + escapeHtml(d.title) +
      '</td>' +
      '<td class="num platform-apple">' + num(d.apple) + '</td>' +
      '<td class="num platform-spotify">' + num(d.spotify) + '</td>' +
      '<td class="num platform-yt">' + num(d.youtubePodcast) + '</td>' +
      (HAS_VIDEO ? '<td class="num platform-yt yt-video-col">' + num(d.youtubeVideo) + '</td>' : '') +
      '<td class="num"><strong>' + num(d.total) + '</strong></td>' +
      '<td class="cmp-cell">' + cmpToAvgHtml(d) + '</td>' +
      '<td class="note-cell">' + noteCell + '</td>' +
    '</tr>';
  }).join('');

  document.querySelectorAll('#data-table th.sortable').forEach(th => {
    const col = th.dataset.sort;
    th.classList.remove('sort-asc', 'sort-desc');
    if (col === tableState.sortBy) th.classList.add(tableState.sortDir === 'desc' ? 'sort-desc' : 'sort-asc');
  });
}

document.querySelectorAll('#data-table th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (tableState.sortBy === col) tableState.sortDir = tableState.sortDir === 'desc' ? 'asc' : 'desc';
    else { tableState.sortBy = col; tableState.sortDir = 'desc'; }
    renderTable();
  });
});

renderTable();
<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `收聽數據_${showName}_${today}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

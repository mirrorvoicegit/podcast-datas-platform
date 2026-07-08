// ============================================================
// 節目收聽數據分析工具 v3
// ============================================================

const state = {
  apple: null,
  spotify: null,
  yt: null,
  merged: null,
  sortBy: 'date',
  sortDir: 'desc',
  searchQuery: '',
  notes: {},  // 製作人手填的每集備註,key 是集數的 _key,純文字、不進統計
  fileInfo: {},  // {apple:{name,count}, spotify:{...}, yt:{...}} 給檔案卡片清單顯示
};

const charts = {};
let staged = null;  // { merged, fuzzyPairs, orphans }

document.getElementById('today-date').textContent =
  new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

// ============================================================
// 期間選擇(下拉選單,全部用日曆單位,依上架日)
// ============================================================
// 計算各種期間的起訖日。回傳 { from: 'YYYY-MM-DD'|'', to: 'YYYY-MM-DD'|'' }
function computePeriod(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 用本地時區格式化,不能用 toISOString(那會轉成 UTC,台灣 UTC+8 會少一天)
  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const toStr = iso(today);

  switch (preset) {
    case 'lastweek': {
      // 上一個完整週一~週日
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
      // 近一個月:今天往前推 30 天
      const from = new Date(today);
      from.setDate(today.getDate() - 30);
      return { from: iso(from), to: toStr };
    }
    case 'thisyear': {
      // 年初至今
      const first = new Date(today.getFullYear(), 0, 1);
      return { from: iso(first), to: toStr };
    }
    case 'all': {
      // 開播至今:用資料裡最早的上架日(載入資料後才知道)
      const earliest = getEarliestReleaseDate();
      return { from: earliest ? iso(earliest) : '', to: toStr };
    }
    default:
      return null; // custom
  }
}

// 找出已上傳資料裡最早的上架日
function getEarliestReleaseDate() {
  const allItems = [...(state.apple || []), ...(state.spotify || []), ...(state.yt || [])];
  let earliest = null;
  for (const item of allItems) {
    const d = parseDate(item.releaseDate);
    if (d && (!earliest || d < earliest)) earliest = d;
  }
  return earliest;
}

// 套用下拉選單選的期間
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
    // 顯示實際套用的日期
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

// 自訂日期改動時,把下拉切到「自訂」
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

// 預設:最近兩週
(function initDateRange() {
  applyPeriodSelect();
})();

// 節目名稱記憶(localStorage)
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

// 製作人記憶(localStorage)
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

// 訂閱數記憶(localStorage)+ 顯示上次數字
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
      const savedAt = localStorage.getItem(key + 'At');
      if (saved) {
        // 顯示上次的數字當 placeholder,讓使用者看得到對照
        input.placeholder = `上次:${saved}`;
        input.dataset.lastValue = saved;
      }
    } catch (e) { /* ignore */ }
    // 輸入時記住,並記下日期
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
// 1. 上傳(拖曳或點選,自動辨識平台)
// ============================================================

// 看 CSV 第一列的欄位名,判斷這個檔是哪個平台。
// 三平台欄位互不重疊:Apple 有 Episode Title+Plays、Spotify 有 name+plays、
// YouTube 有 影片標題+觀看次數,所以看 header 就能可靠辨識,不會誤判。
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
  fileAllInput.value = ''; // 清空,讓同一批檔案能再次選取觸發
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
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.csv'));
  handleMultipleFiles(files);
});

// 逐檔解析:先用 header 辨識平台,再丟給對應的 parsePlatformCSV。
// 同一平台若被丟兩個檔,後者覆蓋前者。解析結果以檔案卡片清單呈現(與 Tool-2 一致)。
function handleMultipleFiles(files) {
  if (!files.length) return;
  const errs = []; // 認不出/解析失敗的檔,額外列出
  let pending = files.length;

  files.forEach(file => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (result) => {
        const headers = result.meta && result.meta.fields ? result.meta.fields : [];
        const platform = detectPlatform(headers);
        if (!platform) {
          errs.push({ name: file.name, msg: '認不出平台' });
        } else {
          try {
            const parsed = parsePlatformCSV(platform, result.data);
            state[platform] = parsed;
            state.fileInfo[platform] = { name: file.name, count: parsed.length };
          } catch (err) {
            errs.push({ name: file.name, msg: err.message });
          }
        }
        if (--pending === 0) finishMulti(errs);
      },
      error: (err) => {
        errs.push({ name: file.name, msg: '讀取失敗' });
        if (--pending === 0) finishMulti(errs);
      }
    });
  });
}

const PLATFORM_LABEL = { apple: 'APPLE', spotify: 'SPOTIFY', yt: 'YOUTUBE' };

function renderFilesList(errs = []) {
  const listEl = document.getElementById('dropzone-msg');
  let html = '';
  ['apple', 'spotify', 'yt'].forEach(p => {
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
  errs.forEach(e => {
    html += `<div class="file-row error">
      <span class="file-platform err">無法辨識</span>
      <span class="file-name" title="${escapeAttr(e.name)}">${escapeHtml(e.name)}</span>
      <span class="file-rows">${escapeHtml(e.msg)}</span>
      <span></span>
    </div>`;
  });
  listEl.innerHTML = html;
  // 綁定移除鈕
  listEl.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const p = btn.dataset.platform;
      state[p] = null;
      delete state.fileInfo[p];
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
  const hasAtLeastTwo = [state.apple, state.spotify, state.yt].filter(Boolean).length >= 2;
  document.getElementById('btn-generate').disabled = !hasAtLeastTwo;
}

// ============================================================
// 2. CSV 解析
// ============================================================
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
      .map(r => ({
        title: r['影片標題'].trim(),
        plays: parseInt(r['觀看次數']) || 0,
        releaseDate: r['影片發布時間'] || '',
        duration: parseInt(r['時間長度']) || 0,
      }));
  }
}

// ============================================================
// 3. 流程控制
// ============================================================
document.getElementById('btn-generate').addEventListener('click', enterFuzzyReview);
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
  document.getElementById('fuzzy-section').style.display = 'none';
  document.getElementById('orphan-section').style.display = 'none';
  window.scrollTo({top: 0, behavior: 'smooth'});
});

// ============================================================
// 4. 進入可疑配對審查
// ============================================================
function enterFuzzyReview() {
  // 如果目前選「從頭至今」,此時資料已載入,重算一次最早上架日
  const sel = document.getElementById('period-select');
  if (sel && sel.value === 'all') {
    applyPeriodSelect();
  }

  const shortsThreshold = parseInt(document.getElementById('shorts-threshold').value) || 180;
  const dateFrom = parseDate(document.getElementById('date-from').value);
  const dateTo = parseDate(document.getElementById('date-to').value);
  if (dateTo) dateTo.setHours(23, 59, 59, 999); // 涵蓋整天

  // 過濾期間
  function inRange(item) {
    const d = parseDate(item.releaseDate);
    if (!d) return true;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  }

  const apple = (state.apple || []).filter(inRange);
  const spotify = (state.spotify || []).filter(inRange);
  let yt = (state.yt || []).filter(inRange).filter(r => r.duration >= shortsThreshold);

  // 第一輪:key 比對合併
  const merged = mergeFirstPass(apple, spotify, yt);

  // 第二輪:找出可疑配對(不直接合併,而是列出讓使用者確認)
  const fuzzyPairs = findFuzzyPairs(merged);

  staged = { merged, fuzzyPairs, dateFrom, dateTo };

  // 如果沒有可疑配對,跳過這步直接到孤兒
  if (fuzzyPairs.length === 0) {
    enterOrphanReview();
    return;
  }

  renderFuzzyTable(fuzzyPairs);

  document.getElementById('upload-section').style.display = 'none';
  document.getElementById('fuzzy-section').style.display = 'block';
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function renderFuzzyTable(pairs) {
  // 依相似度降序排列
  pairs.sort((a, b) => b.sim - a.sim);

  const tbody = document.getElementById('fuzzy-tbody');
  tbody.innerHTML = pairs.map((p, i) => {
    // p.target:孤兒項目(只有 YT 的) / p.match:多平台項目(Apple/Spotify)
    // 但也可能反過來,要區分顯示
    const targetIsYT = p.target.yt !== null && p.target.apple === null && p.target.spotify === null;
    const matchIsYT = p.match.yt !== null && p.match.apple === null && p.match.spotify === null;

    let leftTitle, rightTitle;
    if (targetIsYT) {
      leftTitle = p.match.title;
      rightTitle = p.target.title;
    } else if (matchIsYT) {
      leftTitle = p.target.title;
      rightTitle = p.match.title;
    } else {
      leftTitle = p.target.title;
      rightTitle = p.match.title;
    }

    const dateDiff = dateDiffDays(p.target.dateObj, p.match.dateObj);

    return `
      <tr data-fuzzy-idx="${i}">
        <td><input type="checkbox" class="fuzzy-cb" data-idx="${i}" checked></td>
        <td class="title-cell">${escapeHtml(leftTitle)}</td>
        <td class="title-cell">${escapeHtml(rightTitle)}</td>
        <td class="num">${dateDiff === 0 ? '同天' : dateDiff + ' 天'}</td>
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
// 5. 進入孤兒審查
// ============================================================
function enterOrphanReview() {
  // 套用使用者選擇的可疑配對
  const approvedPairs = [];
  document.querySelectorAll('.fuzzy-cb:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    if (!isNaN(idx)) approvedPairs.push(staged.fuzzyPairs[idx]);
  });

  // 套用配對:把孤兒合併到主項目
  const mergedKeys = new Set();
  approvedPairs.forEach(p => {
    // p.target 是孤兒(只有一個平台),p.match 是要合併進去的對象
    // 把孤兒的平台值加到 match 上
    const targetPlatform = ['apple', 'spotify', 'yt'].find(pl => p.target[pl] !== null);
    if (targetPlatform && p.match[targetPlatform] === null) {
      p.match[targetPlatform] = p.target[targetPlatform];
      p.match._fuzzyMatched = true;
      // 記錄被合併的 YouTube 原標題
      if (targetPlatform === 'yt') {
        p.match._ytOriginalTitle = p.target.title;
      } else if (p.match.title !== p.target.title) {
        // 反向:match 是 YT,target 是 apple/spotify
        // 那 match 標題就是 YT 原標題,需要被取代
        if (p.match.yt !== null && p.match.apple === null && p.match.spotify === null) {
          // 但這代表 match 才是孤兒... 應該不會走到這裡,因為我們已經設定 match 是多平台項目
        }
      }
      mergedKeys.add(p.target._key);
    }
  });

  // 過濾掉已被合併的孤兒
  staged.merged = staged.merged.filter(d => !mergedKeys.has(d._key));

  // v12:記下使用者確認過的配對(_key 是由標題決定的,跨資料集穩定),
  // 讓「開播至今單集平均」等全域統計能把這些集數視為完整,不會誤判成缺平台。
  state.approvedFuzzy = approvedPairs.map(p => {
    const platform = ['apple', 'spotify', 'yt'].find(pl => p.target[pl] !== null);
    return { targetKey: p.target._key, matchKey: p.match._key, platform };
  }).filter(r => r.platform);

  // 算 total
  staged.merged.forEach(d => {
    d.total = (d.apple || 0) + (d.spotify || 0) + (d.yt || 0);
  });

  // 排序
  staged.merged.sort((a, b) => {
    if (!a.dateObj && !b.dateObj) return 0;
    if (!a.dateObj) return 1;
    if (!b.dateObj) return -1;
    return b.dateObj - a.dateObj;
  });

  // 找出孤兒(只在單一平台有資料)
  const orphans = staged.merged.filter(d => {
    return [d.apple, d.spotify, d.yt].filter(v => v !== null).length === 1;
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
    else { platform = 'YouTube'; pillClass = 'yt'; playValue = d.yt; }

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
  document.getElementById('fuzzy-section').style.display = 'none';
  document.getElementById('orphan-section').style.display = 'none';
  document.getElementById('report').classList.add('active');
  window.scrollTo({top: 0, behavior: 'smooth'});

  // v13.1:上傳改由「下載報表」觸發,這裡只清掉上一輪的狀態文字
  setSheetStatus('', '');
}

// ============================================================
// 6. 標題正規化與比對工具
// ============================================================
function normalizeTitle(s) {
  if (!s) return '';
  return s
    .replace(/\s+/g, '')
    .replace(/[\|｜]/g, '|')
    .replace(/[【】\[\]『』「」]/g, '')
    .replace(/[!?。,、:;!?,.:;]/g, '')
    .replace(/\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}/g, '')
    .replace(/EP\d+/gi, '')
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
    if (/[\u4e00-\u9fa5]/.test(c)) {
      const seg2 = norm.slice(i, i+2);
      if (/^[\u4e00-\u9fa5]{2}$/.test(seg2)) tokens.add(seg2);
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

// 用本地時區把日期格式化成 YYYY-MM-DD。
// 不能用 toISOString(),它會轉成 UTC,台灣 UTC+8 在半夜~早上 8 點之間會少一天。
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
// 7. 第一輪合併:key 比對
// ============================================================
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
          apple: null, spotify: null, yt: null,
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
  addByKey(yt, 'yt');

  return Array.from(map.values());
}

// ============================================================
// 8. 第二輪:找出可疑配對(不合併)
// ============================================================
function findFuzzyPairs(merged) {
  const DATE_WINDOW = 3;
  const SIM_THRESHOLD = 0.25;
  const pairs = [];
  const usedKeys = new Set();

  function isOrphan(e) {
    return [e.apple, e.spotify, e.yt].filter(v => v !== null).length === 1;
  }
  function getPlatform(e) {
    if (e.apple !== null) return 'apple';
    if (e.spotify !== null) return 'spotify';
    return 'yt';
  }

  for (let i = 0; i < merged.length; i++) {
    const entryA = merged[i];
    if (usedKeys.has(entryA._key) || !isOrphan(entryA)) continue;
    const pA = getPlatform(entryA);

    let best = null;
    let bestSim = SIM_THRESHOLD;

    for (let j = 0; j < merged.length; j++) {
      if (i === j) continue;
      const entryB = merged[j];
      if (usedKeys.has(entryB._key)) continue;
      if (entryB[pA] !== null) continue; // 對方必須缺孤兒的平台
      if (dateDiffDays(entryA.dateObj, entryB.dateObj) > DATE_WINDOW) continue;

      const sim = jaccardSimilarity(entryA.tokens, entryB.tokens);
      if (sim > bestSim) {
        bestSim = sim;
        best = entryB;
      }
    }

    if (best) {
      pairs.push({ target: entryA, match: best, sim: bestSim });
      usedKeys.add(entryA._key);
      usedKeys.add(best._key);
    }
  }

  return pairs;
}

// ============================================================
// 9. 渲染報表
// ============================================================
function renderReport(showName, data) {
  document.getElementById('report-title').textContent = showName
    ? `數據摘要：${showName}`
    : '數據摘要';

  // 新報表產出:上一輪的 AI 觀點跟這批資料對不上了,清掉(v14)
  state.aiInsight = null;
  const aiOutputEl = document.getElementById('ai-output');
  if (aiOutputEl) aiOutputEl.style.display = 'none';
  setAiStatus('', '');

  // 製表人(選填,有填才顯示),顯示在右上 meta 區
  const producer = document.getElementById('producer-name').value.trim();
  const producerLine = document.getElementById('report-producer-line');
  if (producer) {
    document.getElementById('report-producer').textContent = producer;
    producerLine.style.display = 'grid';
  } else {
    producerLine.style.display = 'none';
  }

  // 日期範圍:用設定的區間,不是資料的最大最小。標籤(分析區間)已在 HTML,這裡只填值。
  const dateFrom = parseDate(document.getElementById('date-from').value);
  const dateTo = parseDate(document.getElementById('date-to').value);
  if (dateFrom && dateTo) {
    document.getElementById('report-date-range').textContent =
      `${formatDate(dateFrom)} — ${formatDate(dateTo)}`;
  } else {
    document.getElementById('report-date-range').textContent = '全部集數';
  }

  // === 期間相關(用篩選後的 data)===
  const periodPlays = data.reduce((s, d) => s + d.total, 0);
  const episodes = data.length;

  // === 不受期間影響的(用全部資料重算)===
  // 把全部集數(不過期間篩選)合併,算開播至今與上個月
  const shortsThreshold = parseInt(document.getElementById('shorts-threshold').value) || 180;
  const allApple = state.apple || [];
  const allSpotify = state.spotify || [];
  const allYt = (state.yt || []).filter(r => r.duration >= shortsThreshold);
  const allMerged = mergeFirstPass(allApple, allSpotify, allYt);

  // mergeFirstPass 回傳的物件只有 apple/spotify/yt 三個平台欄位,沒有 total
  // (total 是主流程在別處才補算的),所以這裡要自己現算,不能直接讀 d.total,
  // 否則會是 undefined 累加成 NaN,畫面顯示「非數值」。
  const rowTotal = d => (d.apple || 0) + (d.spotify || 0) + (d.yt || 0);

  // 開播至今:全部集數的三平台總和
  const allTimePlays = allMerged.reduce((s, d) => s + rowTotal(d), 0);

  // === 開播至今單集平均(v12)===
  // 基準只計入「各上傳平台皆有數據」的集數:例如這次上傳 Apple+Spotify+YouTube,
  // 就只算三平台都有數字的集數;缺任一平台(如 YouTube 沒對到、Reels)的集數不進分母也不進分子。
  // 這是為了避免缺漏平台的集數把平均拉低,造成不公平比較。
  //
  // 注意:allMerged 是第一輪合併,沒經過可疑配對審查,所以先把使用者確認過的配對
  // 重新套上(用 _key 對回來),否則 YouTube 標題不同的集數會被誤判成「缺 YouTube」。
  // 限制:分析區間外的集數沒被審查過,若它的 YouTube 標題不同,仍會被排除在平均之外。
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

  const uploadedPlatforms = ['apple', 'spotify', 'yt'].filter(p => state[p] && state[p].length > 0);
  const completeRows = allMergedReviewed.filter(d => uploadedPlatforms.every(p => d[p] !== null));
  state.allTimeAvg = completeRows.length > 0
    ? Math.round(completeRows.reduce((s, d) => s + rowTotal(d), 0) / completeRows.length)
    : 0;
  state.allTimeAvgCount = completeRows.length;
  state.uploadedPlatforms = uploadedPlatforms;

  // === 開播至今播放排行榜 TOP 10(v12,不受分析區間影響)===
  state.allTimeTop10 = [...allMergedReviewed]
    .sort((a, b) => rowTotal(b) - rowTotal(a))
    .slice(0, 10)
    .map(d => ({ title: d.title, apple: d.apple, spotify: d.spotify, yt: d.yt }));

  // 上個月:上個月 1 號 ~ 月底「上架」的集數總和
  const now = new Date();
  const lastMonthFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthLast = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const lastMonthLabel = `${lastMonthFirst.getFullYear()}/${String(lastMonthFirst.getMonth() + 1).padStart(2, '0')}`;
  // 注意:要用 allMergedReviewed(已重套配對並剔除被吸收的孤兒列),
  // 用 allMerged 會把「值已被吸收進主列的孤兒列」再加一次,重複計算。
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

  // === 彙整表上傳快照(v13)===
  // 只收摘要數字,不含逐集明細與備註。使用者按「上傳到彙整表」(或啟用自動上傳)才會送出。
  const _sumP = p => allMergedReviewed.reduce((s, d) => s + (d[p] || 0), 0);
  const _nowD = new Date();
  state.uploadSnapshot = {
    show: showName || '',
    producer: document.getElementById('producer-name').value.trim(),
    generatedAt: `${localDateStr(_nowD).replace(/-/g, '/')} ${String(_nowD.getHours()).padStart(2, '0')}:${String(_nowD.getMinutes()).padStart(2, '0')}`,
    periodFrom: document.getElementById('date-from').value || '',
    periodTo: document.getElementById('date-to').value || '',
    episodesInPeriod: episodes,
    periodPlays,
    allTimePlays,
    allTimeAvg: state.allTimeAvg,
    allTimeAvgCount: state.allTimeAvgCount,
    lastMonthLabel,
    lastMonthPlays,
    appleTotal: _sumP('apple'),
    spotifyTotal: _sumP('spotify'),
    ytTotal: _sumP('yt'),
    subApple: document.getElementById('sub-apple').value.trim(),
    subSpotify: document.getElementById('sub-spotify').value.trim(),
    subYt: document.getElementById('sub-yt').value.trim(),
    totalEpisodes: data.length,
  };

  // 訂閱數區
  renderSubscribers();

  renderInsights(data);
  renderMatchSummary(data);
  renderCharts(data);
  renderTable(data);
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
  const ytTotal = data.reduce((s, d) => s + (d.yt || 0), 0);
  const grand = appleTotal + spotifyTotal + ytTotal;
  const avg = data.length > 0 ? Math.round(grand / data.length) : 0;

  const shares = [
    { name: 'Apple Podcast', val: appleTotal },
    { name: 'Spotify', val: spotifyTotal },
    { name: 'YouTube', val: ytTotal },
  ].sort((a, b) => b.val - a.val);
  const topShare = grand > 0 ? (shares[0].val / grand) * 100 : 0;

  if (topShare > 50) {
    insights.push(`<strong>流量高度集中在 ${shares[0].name}</strong>(佔 ${topShare.toFixed(1)}%)。其他兩個平台合計僅 ${(100-topShare).toFixed(1)}%,可考慮加強較弱平台的露出。`);
  } else if (topShare < 40 && grand > 0) {
    insights.push(`<strong>三平台分布均衡</strong>,最大來源 ${shares[0].name} 也只佔 ${topShare.toFixed(1)}%。代表節目在各平台都有穩定觸及,沒有特別偏重單一平台。`);
  } else if (grand > 0) {
    insights.push(`主要流量來源是 <strong>${shares[0].name}</strong>(${topShare.toFixed(1)}%),其次為 ${shares[1].name}(${((shares[1].val/grand)*100).toFixed(1)}%)。`);
  }

  const top = data.reduce((m, d) => d.total > (m?.total || 0) ? d : m, null);
  if (top && avg > 0 && top.total > avg * 2) {
    const platformContrib = [
      { name: 'Apple', val: top.apple || 0 },
      { name: 'Spotify', val: top.spotify || 0 },
      { name: 'YouTube', val: top.yt || 0 },
    ].sort((a, b) => b.val - a.val);
    const topPct = ((platformContrib[0].val / top.total) * 100).toFixed(0);
    insights.push(`<strong>最高單集「${escapeHtml(truncate(top.title, 30))}」</strong>達 ${num(top.total)} 次,是單集平均(${num(avg)})的 ${(top.total/avg).toFixed(1)} 倍。主要由 ${platformContrib[0].name} 貢獻(${topPct}%),建議分析該集在該平台的成功原因(標題、選題、上線時機)。`);
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
  const allThree = data.filter(d => d.apple !== null && d.spotify !== null && d.yt !== null).length;
  const apple = data.filter(d => d.apple !== null).length;
  const spotify = data.filter(d => d.spotify !== null).length;
  const yt = data.filter(d => d.yt !== null).length;
  const fuzzy = data.filter(d => d._fuzzyMatched).length;

  document.getElementById('match-summary').innerHTML = `
    <div class="match-stat"><span>三平台都有</span><strong>${allThree}</strong></div>
    <div class="match-stat"><span>Apple 有資料</span><strong>${apple}</strong></div>
    <div class="match-stat"><span>Spotify 有資料</span><strong>${spotify}</strong></div>
    <div class="match-stat"><span>YouTube 有資料</span><strong>${yt}</strong></div>
    <div class="match-stat"><span>單集總數</span><strong>${data.length}</strong></div>
    ${fuzzy > 0 ? `<div class="match-stat"><span>後備比對成功</span><strong>${fuzzy}</strong></div>` : ''}
    <div class="match-stat"><span>開播至今單集平均</span><strong>${num(state.allTimeAvg)}</strong></div>
  `;
}

// ============================================================
// 10. 圖表
// ============================================================
function renderCharts(data) {
  Object.values(charts).forEach(c => c && c.destroy());

  Chart.defaults.font.family = "'Noto Sans TC', sans-serif";
  Chart.defaults.color = '#444';
  Chart.defaults.font.size = 12;

  // yt 必須用六位數色碼:程式會在色碼後面接兩位透明度(如 + '20'),
// 三位數 '#555' 接出來是 '#55520' 無效色,YouTube 圖例方塊會變黑色實心(v12 修過)。
const PALETTE = { apple: '#c8341a', spotify: '#1d9b54', yt: '#555555' };

  const sorted = [...data].filter(d => d.dateObj).sort((a, b) => a.dateObj - b.dateObj);
  charts.trend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: {
      labels: sorted.map(d => formatDate(d.dateObj)),
      datasets: [
        { label: 'Apple', data: sorted.map(d => d.apple), borderColor: PALETTE.apple, backgroundColor: PALETTE.apple + '20', tension: 0.3, spanGaps: true },
        { label: 'Spotify', data: sorted.map(d => d.spotify), borderColor: PALETTE.spotify, backgroundColor: PALETTE.spotify + '20', tension: 0.3, spanGaps: true },
        { label: 'YouTube', data: sorted.map(d => d.yt), borderColor: PALETTE.yt, backgroundColor: PALETTE.yt + '20', tension: 0.3, spanGaps: true },
      ]
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

  const top10 = [...data].sort((a, b) => b.total - a.total).slice(0, 10);
  charts.ranking = new Chart(document.getElementById('chart-ranking'), {
    type: 'bar',
    data: {
      labels: top10.map(d => truncate(d.title, 22)),
      datasets: [
        { label: 'Apple', data: top10.map(d => d.apple || 0), backgroundColor: PALETTE.apple },
        { label: 'Spotify', data: top10.map(d => d.spotify || 0), backgroundColor: PALETTE.spotify },
        { label: 'YouTube', data: top10.map(d => d.yt || 0), backgroundColor: PALETTE.yt },
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', align: 'end' } },
      scales: {
        x: { stacked: true, beginAtZero: true, grid: { color: '#e5dec9' } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, crossAlign: 'far' } }
      }
    }
  });

  // 開播至今播放排行榜 TOP 10(v12):用全部資料,不受分析區間影響
  const allTop10 = state.allTimeTop10 || [];
  charts.rankingAlltime = new Chart(document.getElementById('chart-ranking-alltime'), {
    type: 'bar',
    data: {
      labels: allTop10.map(d => truncate(d.title, 22)),
      datasets: [
        { label: 'Apple', data: allTop10.map(d => d.apple || 0), backgroundColor: PALETTE.apple },
        { label: 'Spotify', data: allTop10.map(d => d.spotify || 0), backgroundColor: PALETTE.spotify },
        { label: 'YouTube', data: allTop10.map(d => d.yt || 0), backgroundColor: PALETTE.yt },
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', align: 'end' } },
      scales: {
        x: { stacked: true, beginAtZero: true, grid: { color: '#e5dec9' } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, crossAlign: 'far' } }
      }
    }
  });

  const appleTotal = data.reduce((s, d) => s + (d.apple || 0), 0);
  const spotifyTotal = data.reduce((s, d) => s + (d.spotify || 0), 0);
  const ytTotal = data.reduce((s, d) => s + (d.yt || 0), 0);
  const grand = appleTotal + spotifyTotal + ytTotal;

  charts.share = new Chart(document.getElementById('chart-share'), {
    type: 'doughnut',
    data: {
      labels: ['Apple Podcast', 'Spotify', 'YouTube'],
      datasets: [{
        data: [appleTotal, spotifyTotal, ytTotal],
        backgroundColor: [PALETTE.apple, PALETTE.spotify, PALETTE.yt],
        borderColor: '#f5f1ea', borderWidth: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = grand > 0 ? ((ctx.parsed / grand) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${num(ctx.parsed)} (${pct}%)`;
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
        ctx.fillText(num(grand), cx, cy + 2);
        ctx.fillStyle = '#888';
        ctx.font = '11px "Noto Sans TC", sans-serif';
        ctx.fillText('三平台累積', cx, cy + 22);
        ctx.restore();
      }
    }]
  });

  const shareLegend = document.getElementById('share-legend');
  if (shareLegend) {
    const items = [
      { name: 'Apple Podcast', val: appleTotal, color: PALETTE.apple },
      { name: 'Spotify', val: spotifyTotal, color: PALETTE.spotify },
      { name: 'YouTube', val: ytTotal, color: PALETTE.yt },
    ];
    shareLegend.innerHTML = items.map(it => {
      const pct = grand > 0 ? ((it.val / grand) * 100).toFixed(1) : 0;
      return `
        <div class="legend-row">
          <span class="legend-dot" style="background:${it.color}"></span>
          <span class="legend-name">${it.name}</span>
          <span class="legend-val">${num(it.val)}</span>
          <span class="legend-pct">${pct}%</span>
        </div>
      `;
    }).join('');
  }
}

// ============================================================
// 11. 表格(排序 + 搜尋)
// ============================================================

// 「收聽平均比較」欄(v12):該集全平台總計 vs 開播至今單集平均。
// 高於平均=紅色箭頭朝上、低於=綠色箭頭朝下(台股慣例:紅漲綠跌)。
// 缺任一上傳平台數據的集數不參與比較(顯示 —),因為它的總計天生偏低,比了不公平。
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
  // 套用搜尋:用空格分隔多個關鍵字,符合任一個就顯示(OR)。
  // 例:打「鏡爆點 社會線上」會把這兩種集數一起列出來。
  let data = allData;
  if (state.searchQuery) {
    const terms = state.searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
      data = allData.filter(d => {
        const title = d.title.toLowerCase();
        const ytTitle = d._ytOriginalTitle ? d._ytOriginalTitle.toLowerCase() : '';
        return terms.some(t => title.includes(t) || ytTitle.includes(t));
      });
    }
  }

  // 計算「上一週」的起點:上一個完整週的週一(0:00)
  // 標記範圍 = 上週一 ~ 今天(涵蓋上一個完整週,若有本週最新集也一起標)
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const dow = today.getDay() === 0 ? 7 : today.getDay();
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - (dow - 1));
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  lastMonday.setHours(0, 0, 0, 0);
  // 判斷某集是否在標記範圍(上週一 ~ 今天)
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
      case 'yt': av = a.yt ?? -1; bv = b.yt ?? -1; break;
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
    if (d.yt === null) missing.push('YouTube');
    let note = missing.length > 0 ? `<span class="tag missing">缺 ${missing.join('、')}</span>` : '';
    if (d._ytOriginalTitle) {
      note += `<span class="tag" style="background:rgba(244,226,133,0.5);color:#7a5d00;border:none;" title="${escapeAttr(d._ytOriginalTitle)}">YouTube 標題不同</span>`;
    }
    // 系統標記(上)+ 製作人可編輯備註(下)。備註綁 _key,排序/搜尋都不會跑掉。
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
          ${d._ytOriginalTitle ? `<div style="font-size:11px;color:var(--ink-faint);margin-top:4px;font-style:italic;">YouTube:${escapeHtml(d._ytOriginalTitle)}</div>` : ''}
        </td>
        <td class="num platform-apple">${num(d.apple)}</td>
        <td class="num platform-spotify">${num(d.spotify)}</td>
        <td class="num platform-yt">${num(d.yt)}</td>
        <td class="num"><strong>${num(d.total)}</strong></td>
        <td class="cmp-cell">${cmpToAvgHtml(d)}</td>
        <td class="note-cell">${noteCell}</td>
      </tr>
    `;
  }).join('');

  // 綁定備註輸入:打字即時存進 state.notes(以 _key 為鍵)。
  // 用 input 事件邊打邊存,重新排序或搜尋時不會掉。
  tbody.querySelectorAll('.note-input').forEach(ta => {
    // 依內容自動長高。注意:首次渲染時欄寬可能還沒算好,scrollHeight 會偏小把框壓扁,
    // 所以只在「有內容」時才依 scrollHeight 調高,空框一律維持 CSS 的 min-height。
    const autoGrow = () => {
      if (!ta.value) { ta.style.height = ''; return; }  // 空:交給 CSS min-height
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

  // 更新表頭排序視覺
  document.querySelectorAll('#data-table th.sortable').forEach(th => {
    const col = th.dataset.sort;
    th.classList.remove('sort-asc', 'sort-desc');
    if (col === state.sortBy) th.classList.add(state.sortDir === 'desc' ? 'sort-desc' : 'sort-asc');
  });

  // 更新搜尋結果計數
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

// 搜尋框
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
// 11.5 上傳摘要到彙整表(v13,Google Apps Script;v13.1 改為跟著「下載報表」自動觸發)
// ============================================================
// 只送 state.uploadSnapshot 的摘要數字,不含逐集明細與備註。
// POST 用預設 Content-Type(text/plain)避免 CORS preflight——Apps Script 不會回應 OPTIONS。
const SHEET_CFG_KEYS = { url: 'tool1SheetUrl', token: 'tool1SheetToken' };

// 預設通行碼:寫死在程式裡讓製作人免設定。注意:這個 repo 是公開的,
// 這組通行碼等於公開,擋的只是無聊亂寫,不是真正的安全機制(維護者已知情)。
const DEFAULT_SHEET_TOKEN = '1oqZhaoCt3-Exr8cpvTf1uHczG_2qzpszlzwZLkl8X1O9OS9NzDdz2vS7';
// 彙整表網址預設值:維護者部署 Apps Script 後,把網址填進下面引號內,
// 所有製作人就完全免設定;留空則各自在「彙整表設定」填一次。
const DEFAULT_SHEET_URL = '';

function getSheetCfg() {
  try {
    return {
      url: localStorage.getItem(SHEET_CFG_KEYS.url) || DEFAULT_SHEET_URL,
      token: localStorage.getItem(SHEET_CFG_KEYS.token) || DEFAULT_SHEET_TOKEN,
    };
  } catch (e) { return { url: DEFAULT_SHEET_URL, token: DEFAULT_SHEET_TOKEN }; }
}

function setSheetStatus(msg, kind) {
  const el = document.getElementById('sheet-upload-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'sheet-status' + (kind ? ' ' + kind : '');
}

// v13.1:由「下載報表」觸發。上傳失敗不影響下載(報表照樣產出,狀態列顯示原因)。
async function uploadToSheet() {
  const cfg = getSheetCfg();
  if (!cfg.url || !cfg.token) {
    setSheetStatus('彙整表未設定,這次只下載報表、沒有上傳(點右方「彙整表設定」填入網址)', 'warn');
    return;
  }
  if (!state.uploadSnapshot) return;
  if (!state.uploadSnapshot.show) {
    setSheetStatus('報表已下載,但沒上傳彙整表:請填「節目名稱」後重新下載(彙整表以節目名稱歸戶)', 'warn');
    return;
  }
  setSheetStatus('報表摘要上傳中…', '');
  try {
    const resp = await fetch(cfg.url, {
      method: 'POST',
      body: JSON.stringify({ token: cfg.token, tool: 'RSS節目收聽數據分析', ...state.uploadSnapshot }),
    });
    const out = await resp.json().catch(() => null);
    if (out && out.ok) {
      setSheetStatus(`報表摘要已同步到彙整表(${state.uploadSnapshot.generatedAt})`, 'ok');
    } else {
      setSheetStatus(`彙整表上傳失敗:${out && out.error ? out.error : 'HTTP ' + resp.status}(報表本身已正常下載)`, 'err');
    }
  } catch (e) {
    setSheetStatus('彙整表上傳失敗:連不到彙整表網址(報表本身已正常下載)', 'err');
  }
}

function toggleSheetSettings(show) {
  const panel = document.getElementById('sheet-settings');
  if (!panel) return;
  const want = show === undefined ? panel.style.display === 'none' : show;
  panel.style.display = want ? 'block' : 'none';
  if (want) {
    const cfg = getSheetCfg();
    document.getElementById('sheet-url').value = cfg.url;
    document.getElementById('sheet-token').value = cfg.token;
  }
}

(function initSheetUpload() {
  const linkSettings = document.getElementById('btn-sheet-settings');
  const btnSave = document.getElementById('btn-sheet-save');
  if (!linkSettings) return;
  linkSettings.addEventListener('click', (e) => { e.preventDefault(); toggleSheetSettings(); });
  btnSave.addEventListener('click', () => {
    try {
      localStorage.setItem(SHEET_CFG_KEYS.url, document.getElementById('sheet-url').value.trim());
      localStorage.setItem(SHEET_CFG_KEYS.token, document.getElementById('sheet-token').value.trim());
    } catch (e) { /* ignore */ }
    toggleSheetSettings(false);
    setSheetStatus('設定已儲存,下次按「下載報表」時會自動同步', 'ok');
  });
})();

// ============================================================
// 11.6 AI 觀點(v14,測試功能,Google Gemini API)
// ============================================================
// 只在使用者主動按「產生 AI 觀點」時才呼叫,不自動觸發、不隨自動上傳/下載觸發。
// 送出去的內容只有:節目名稱、期間、彙總數字、本期單集標題與各平台數字(見 buildAiPrompt)。
// 不含備註、原始 CSV、任何個資(平台本來就沒有聽眾個資,只有匿名累積播放數)。
const AI_CFG_KEYS = { key: 'tool1GeminiKey', model: 'tool1GeminiModel' };

function getGeminiCfg() {
  try {
    return {
      key: localStorage.getItem(AI_CFG_KEYS.key) || '',
      model: localStorage.getItem(AI_CFG_KEYS.model) || 'gemini-2.5-flash',
    };
  } catch (e) { return { key: '', model: 'gemini-2.5-flash' }; }
}

function setAiStatus(msg, kind) {
  const el = document.getElementById('ai-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'sheet-status' + (kind ? ' ' + kind : '');
}

function toggleAiSettings(show) {
  const panel = document.getElementById('ai-settings');
  if (!panel) return;
  const want = show === undefined ? panel.style.display === 'none' : show;
  panel.style.display = want ? 'block' : 'none';
  if (want) {
    const cfg = getGeminiCfg();
    document.getElementById('ai-key').value = cfg.key;
    document.getElementById('ai-model').value = cfg.model;
  }
}

// 組 prompt:彙總數字取自 state.uploadSnapshot(彙整表上傳用的同一份摘要,見上方 11.5),
// 單集列表取自目前畫面顯示的 state.merged(已套用分析區間篩選),依總計排序取前 20 集避免 payload 過大。
function buildAiPrompt() {
  const s = state.uploadSnapshot || {};
  const top = [...(state.merged || [])]
    .sort((a, b) => b.total - a.total)
    .slice(0, 20)
    .map((d, i) => `${i + 1}. ${d.title}｜Apple:${num(d.apple)}｜Spotify:${num(d.spotify)}｜YouTube:${num(d.yt)}｜總計:${num(d.total)}`)
    .join('\n');

  return `你是幫 Podcast 節目製作人看數據的分析助理。以下是「${s.show || '(未命名節目)'}」節目的收聽數據摘要,請用繁體中文,針對「收聽表現」與「選題/標題」兩個角度給出觀察與建議。

規則:
- 只根據下面提供的數字與標題推論,不要編造沒有依據的事實或平台演算法機制,不確定的地方就明說不確定。
- 三平台的計算邏輯不同,且數字都是「累積至今」的快照、不是單一時段獨立發生量,越新的集數累積時間越短,分析時要考慮這個限制,不要做過度推論的因果結論。
- 語氣直接、務實,先講結論再講細節,不要用「首先、其次」這種制式起手式,不要用英文裝飾詞或行銷語氣。
- 使用對象是節目製作人本人,不是投資人簡報,不用「亮點」「洞察」這種空話,要講具體可執行的東西。
- 產出約 200-350 字,不要用 Markdown 標題符號,可以分兩三小段。

[數據摘要]
分析區間:${s.periodFrom || '—'} ~ ${s.periodTo || '—'}
期間集數:${num(s.episodesInPeriod)}
期間總收聽:${num(s.periodPlays)}
開播至今總收聽:${num(s.allTimePlays)}
開播至今單集平均:${num(s.allTimeAvg)}(計入 ${num(s.allTimeAvgCount)} 集,缺任一平台數據的集數不計入)
Apple累積:${num(s.appleTotal)} / Spotify累積:${num(s.spotifyTotal)} / YouTube累積:${num(s.ytTotal)}

[本期單集列表,依全平台總計排序,最多列前 20 集]
${top || '(本期無單集資料)'}`;
}

function renderAiOutput() {
  const wrap = document.getElementById('ai-output');
  if (!state.aiInsight) { wrap.style.display = 'none'; return; }
  document.getElementById('ai-text').textContent = state.aiInsight.text;
  document.getElementById('ai-meta').textContent = `${state.aiInsight.model} · 產生於 ${state.aiInsight.generatedAt}`;
  wrap.style.display = 'block';
}

async function generateAiInsight() {
  const cfg = getGeminiCfg();
  if (!cfg.key) {
    toggleAiSettings(true);
    setAiStatus('請先在「AI 設定」貼上你的 Gemini API Key', 'warn');
    return;
  }
  if (!state.merged || !state.uploadSnapshot) {
    setAiStatus('請先產出報表', 'warn');
    return;
  }
  setAiStatus('AI 分析中…', '');
  document.getElementById('ai-output').style.display = 'none';

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: buildAiPrompt() }] }] }),
      }
    );
    const out = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = out && out.error && out.error.message ? out.error.message : `HTTP ${resp.status}`;
      setAiStatus(`AI 分析失敗:${msg}`, 'err');
      return;
    }
    const parts = out && out.candidates && out.candidates[0] && out.candidates[0].content && out.candidates[0].content.parts;
    const text = parts ? parts.map(p => p.text || '').join('') : '';
    if (!text.trim()) {
      setAiStatus('AI 沒有回傳內容,請再試一次', 'err');
      return;
    }
    const now = new Date();
    state.aiInsight = {
      text: text.trim(),
      model: cfg.model,
      generatedAt: `${localDateStr(now).replace(/-/g, '/')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    };
    renderAiOutput();
    setAiStatus(`已產生(${state.aiInsight.generatedAt})`, 'ok');
  } catch (e) {
    setAiStatus('AI 分析失敗:連不到 Gemini API(檢查金鑰、網路,或瀏覽器擋了跨網域請求)', 'err');
  }
}

(function initAiInsight() {
  const btnGen = document.getElementById('btn-ai-generate');
  const btnSettings = document.getElementById('btn-ai-settings');
  const btnSave = document.getElementById('btn-ai-save');
  if (!btnGen) return;
  btnGen.addEventListener('click', generateAiInsight);
  btnSettings.addEventListener('click', (e) => { e.preventDefault(); toggleAiSettings(); });
  btnSave.addEventListener('click', () => {
    try {
      localStorage.setItem(AI_CFG_KEYS.key, document.getElementById('ai-key').value.trim());
      localStorage.setItem(AI_CFG_KEYS.model, document.getElementById('ai-model').value);
    } catch (e) { /* ignore */ }
    toggleAiSettings(false);
    setAiStatus('設定已儲存', 'ok');
  });
})();

// ============================================================
// 12. 匯出獨立 HTML
// ============================================================
document.getElementById('btn-print').addEventListener('click', () => window.print());
document.getElementById('btn-export-html').addEventListener('click', exportStandaloneHTML);

async function exportStandaloneHTML() {
  if (!state.merged) return;

  // v13.1:按「下載報表」時一併把摘要同步到彙整表。
  // 不 await:上傳失敗或很慢都不影響下載,結果顯示在狀態列。
  uploadToSheet();
  const showName = document.getElementById('show-name').value.trim() || '節目';
  const producer = document.getElementById('producer-name').value.trim();
  const today = localDateStr();
  // 報表產出時間:本地時區、清楚的 YYYY/MM/DD HH:MM
  const _now = new Date();
  const exportTimeStr = `${localDateStr(_now).replace(/-/g, '/')} ${String(_now.getHours()).padStart(2,'0')}:${String(_now.getMinutes()).padStart(2,'0')}`;

  // 抓 Chart.js 程式碼 inline,避免 iPad/離線環境載不到
  let chartJsCode = '';
  try {
    const resp = await fetch('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js');
    chartJsCode = await resp.text();
  } catch (e) {
    console.warn('Chart.js fetch failed, fallback to CDN', e);
  }

  // 把資料 inline
  // 計算「上一週」標記範圍(上週一 ~ 今天),匯出時固定下來當快照
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
    yt: d.yt,
    total: d.total,
    fuzzy: !!d._fuzzyMatched,
    ytOriginalTitle: d._ytOriginalTitle || null,
    recentWeek: _isRecentWeek(d.dateObj),
    note: (state.notes[d._key] || '').trim() || null,  // 製作人手填備註,凍結進快照
    // v12:各上傳平台皆有數據才參與「收聽平均比較」,匯出時把判斷結果凍結下來
    complete: (state.uploadedPlatforms || []).length > 0 &&
      state.uploadedPlatforms.every(p => d[p] !== null),
  }));

  // v12:開播至今單集平均 + 開播至今 TOP 10,匯出時凍結成快照
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

  // AI 觀點(v14):沒產生過就整塊移除,不留空殼。有產生的話,#ai-output 的內容
  // 已經是 renderAiOutput() 寫進真實 DOM 的靜態文字,隨 cloneNode 一起凍結進匯出檔。
  if (!state.aiInsight) {
    const aiBlock = reportSection.querySelector('#ai-insight-block');
    if (aiBlock) aiBlock.remove();
  } else {
    const aiBlock = reportSection.querySelector('#ai-insight-block');
    if (aiBlock) aiBlock.removeAttribute('id');
  }

  // 把可編輯的備註 textarea 凍結成靜態文字。
  // textarea 的值不會被 cloneNode/outerHTML 帶出來,所以從 state.notes(真實來源)取值,
  // 換成純文字 div。沒填備註的就移除,讓匯出檔乾淨。
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
      <span>鏡好聽節目組專用</span>
      <span>報表產出時間 ${exportTimeStr}</span>
    </div>
    <h1>RSS節目收聽<br>數據分析報告</h1>
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

const data = EMBEDDED_DATA.map(d => ({
  ...d,
  dateObj: d.dateISO ? new Date(d.dateISO) : null,
}));

// yt 必須用六位數色碼:程式會在色碼後面接兩位透明度(如 + '20'),
// 三位數 '#555' 接出來是 '#55520' 無效色,YouTube 圖例方塊會變黑色實心(v12 修過)。
const PALETTE = { apple: '#c8341a', spotify: '#1d9b54', yt: '#555555' };

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

// 「收聽平均比較」欄(v12):與主程式的 cmpToAvgHtml 同邏輯,基準與 complete 旗標已凍結
function cmpToAvgHtml(d) {
  if (!ALLTIME.avg || !d.complete) return '—';
  const diffPct = ((d.total - ALLTIME.avg) / ALLTIME.avg) * 100;
  if (d.total > ALLTIME.avg) return '<span class="cmp-avg up">▲ +' + diffPct.toFixed(0) + '%</span>';
  if (d.total < ALLTIME.avg) return '<span class="cmp-avg down">▼ ' + diffPct.toFixed(0) + '%</span>';
  return '<span class="cmp-avg">持平</span>';
}

// 設定訂閱數
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

const sorted = [...data].filter(d => d.dateObj).sort((a, b) => a.dateObj - b.dateObj);
new Chart(document.getElementById('chart-trend'), {
  type: 'line',
  data: {
    labels: sorted.map(d => formatDate(d.dateObj)),
    datasets: [
      { label: 'Apple', data: sorted.map(d => d.apple), borderColor: PALETTE.apple, backgroundColor: PALETTE.apple + '20', tension: 0.3, spanGaps: true },
      { label: 'Spotify', data: sorted.map(d => d.spotify), borderColor: PALETTE.spotify, backgroundColor: PALETTE.spotify + '20', tension: 0.3, spanGaps: true },
      { label: 'YouTube', data: sorted.map(d => d.yt), borderColor: PALETTE.yt, backgroundColor: PALETTE.yt + '20', tension: 0.3, spanGaps: true },
    ]
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

const top10 = [...data].sort((a, b) => b.total - a.total).slice(0, 10);
new Chart(document.getElementById('chart-ranking'), {
  type: 'bar',
  data: {
    labels: top10.map(d => truncate(d.title, 22)),
    datasets: [
      { label: 'Apple', data: top10.map(d => d.apple || 0), backgroundColor: PALETTE.apple },
      { label: 'Spotify', data: top10.map(d => d.spotify || 0), backgroundColor: PALETTE.spotify },
      { label: 'YouTube', data: top10.map(d => d.yt || 0), backgroundColor: PALETTE.yt },
    ]
  },
  options: {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top', align: 'end' } },
    scales: {
      x: { stacked: true, beginAtZero: true, grid: { color: '#e5dec9' } },
      y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, crossAlign: 'far' } }
    }
  }
});

// 開播至今播放排行榜 TOP 10(v12):資料已在匯出時凍結於 ALLTIME.top10
new Chart(document.getElementById('chart-ranking-alltime'), {
  type: 'bar',
  data: {
    labels: ALLTIME.top10.map(d => truncate(d.title, 22)),
    datasets: [
      { label: 'Apple', data: ALLTIME.top10.map(d => d.apple || 0), backgroundColor: PALETTE.apple },
      { label: 'Spotify', data: ALLTIME.top10.map(d => d.spotify || 0), backgroundColor: PALETTE.spotify },
      { label: 'YouTube', data: ALLTIME.top10.map(d => d.yt || 0), backgroundColor: PALETTE.yt },
    ]
  },
  options: {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top', align: 'end' } },
    scales: {
      x: { stacked: true, beginAtZero: true, grid: { color: '#e5dec9' } },
      y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, crossAlign: 'far' } }
    }
  }
});

const appleTotal = data.reduce((s, d) => s + (d.apple || 0), 0);
const spotifyTotal = data.reduce((s, d) => s + (d.spotify || 0), 0);
const ytTotal = data.reduce((s, d) => s + (d.yt || 0), 0);
const grand = appleTotal + spotifyTotal + ytTotal;

new Chart(document.getElementById('chart-share'), {
  type: 'doughnut',
  data: {
    labels: ['Apple Podcast', 'Spotify', 'YouTube'],
    datasets: [{
      data: [appleTotal, spotifyTotal, ytTotal],
      backgroundColor: [PALETTE.apple, PALETTE.spotify, PALETTE.yt],
      borderColor: '#f5f1ea', borderWidth: 3,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const pct = grand > 0 ? ((ctx.parsed / grand) * 100).toFixed(1) : 0;
            return ctx.label + ': ' + num(ctx.parsed) + ' (' + pct + '%)';
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
      ctx.fillText(num(grand), cx, cy + 2);
      ctx.fillStyle = '#888';
      ctx.font = '11px "Noto Sans TC", sans-serif';
      ctx.fillText('三平台累積', cx, cy + 22);
      ctx.restore();
    }
  }]
});

const shareLegend = document.getElementById('share-legend');
if (shareLegend) {
  const items = [
    { name: 'Apple Podcast', val: appleTotal, color: PALETTE.apple },
    { name: 'Spotify', val: spotifyTotal, color: PALETTE.spotify },
    { name: 'YouTube', val: ytTotal, color: PALETTE.yt },
  ];
  shareLegend.innerHTML = items.map(it => {
    const pct = grand > 0 ? ((it.val / grand) * 100).toFixed(1) : 0;
    return '<div class="legend-row">' +
      '<span class="legend-dot" style="background:' + it.color + '"></span>' +
      '<span class="legend-name">' + it.name + '</span>' +
      '<span class="legend-val">' + num(it.val) + '</span>' +
      '<span class="legend-pct">' + pct + '%</span>' +
    '</div>';
  }).join('');
}

// 表格(排序 + 搜尋)
const tableState = { sortBy: 'date', sortDir: 'desc', searchQuery: '' };

function renderTable() {
  let filtered = data;
  if (tableState.searchQuery) {
    const q = tableState.searchQuery.toLowerCase();
    filtered = data.filter(d =>
      d.title.toLowerCase().includes(q) ||
      (d.ytOriginalTitle && d.ytOriginalTitle.toLowerCase().includes(q))
    );
  }
  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    switch (tableState.sortBy) {
      case 'date': av = a.dateObj ? a.dateObj.getTime() : 0; bv = b.dateObj ? b.dateObj.getTime() : 0; break;
      case 'apple': av = a.apple ?? -1; bv = b.apple ?? -1; break;
      case 'spotify': av = a.spotify ?? -1; bv = b.spotify ?? -1; break;
      case 'yt': av = a.yt ?? -1; bv = b.yt ?? -1; break;
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
    if (d.yt === null) missing.push('YouTube');
    let note = missing.length > 0 ? '<span class="tag missing">缺 ' + missing.join('、') + '</span>' : '';
    if (d.ytOriginalTitle) {
      note += '<span class="tag" style="background:rgba(244,226,133,0.5);color:#7a5d00;border:none;">YouTube 標題不同</span>';
    }
    // 備註欄:系統標記(上)+ 製作人凍結備註(下)。匯出檔為靜態,備註不可再編輯。
    const noteCell =
      (note ? '<div class="note-tags">' + note + '</div>' : '') +
      (d.note ? '<div class="note-frozen">' + escapeHtml(d.note) + '</div>' : '');
    return '<tr' + (d.recentWeek ? ' class="recent-week"' : '') + '>' +
      '<td>' + formatDate(d.dateObj) + '</td>' +
      '<td class="episode-title">' + escapeHtml(d.title) +
        (d.ytOriginalTitle ? '<div style="font-size:11px;color:var(--ink-faint);margin-top:4px;font-style:italic;">YouTube:' + escapeHtml(d.ytOriginalTitle) + '</div>' : '') +
      '</td>' +
      '<td class="num platform-apple">' + num(d.apple) + '</td>' +
      '<td class="num platform-spotify">' + num(d.spotify) + '</td>' +
      '<td class="num platform-yt">' + num(d.yt) + '</td>' +
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

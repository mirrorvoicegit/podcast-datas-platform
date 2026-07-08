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

  // 上個月:上個月 1 號 ~ 月底「上架」的集數總和
  const now = new Date();
  const lastMonthFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthLast = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const lastMonthLabel = `${lastMonthFirst.getFullYear()}/${String(lastMonthFirst.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthPlays = allMerged.reduce((s, d) => {
    const dt = d.dateObj;
    if (dt && dt >= lastMonthFirst && dt <= lastMonthLast) return s + rowTotal(d);
    return s;
  }, 0);

  document.getElementById('sum-episodes').textContent = num(episodes);
  document.getElementById('sum-alltime').textContent = num(allTimePlays);
  document.getElementById('sum-lastmonth').textContent = num(lastMonthPlays);
  document.getElementById('sum-lastmonth-label').textContent = `${lastMonthLabel} 上架集數`;
  document.getElementById('sum-period').textContent = num(periodPlays);

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

  const PALETTE = { apple: '#c8341a', spotify: '#1d9b54', yt: '#555' };

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
        legend: { position: 'top', align: 'end' },
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
// 12. 匯出獨立 HTML
// ============================================================
document.getElementById('btn-print').addEventListener('click', () => window.print());
document.getElementById('btn-export-html').addEventListener('click', exportStandaloneHTML);

async function exportStandaloneHTML() {
  if (!state.merged) return;
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
  }));

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

const data = EMBEDDED_DATA.map(d => ({
  ...d,
  dateObj: d.dateISO ? new Date(d.dateISO) : null,
}));

const PALETTE = { apple: '#c8341a', spotify: '#1d9b54', yt: '#555' };

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
      legend: { position: 'top', align: 'end' },
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

// ============================================================
// 鏡好聽平台收聽分析
// ============================================================

// 頂部日期(與 Tool-1 一致)
(function () {
  const el = document.getElementById('today-date');
  if (el) el.textContent = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
})();

// 製表人記憶(localStorage,與 Tool-1 各自獨立,不共用)
(function initProducerMemory() {
  const input = document.getElementById('producer-name');
  if (!input) return;
  try {
    const saved = localStorage.getItem('tool2Producer');
    if (saved) input.value = saved;
  } catch (e) { /* ignore */ }
  input.addEventListener('input', () => {
    try { localStorage.setItem('tool2Producer', input.value.trim()); } catch (e) { /* ignore */ }
    // 若報表已產出,即時更新製表人顯示
    const pLine = document.getElementById('report-producer-line');
    if (pLine) {
      const v = input.value.trim();
      if (v) { document.getElementById('report-producer').textContent = v; pLine.style.display = 'grid'; }
      else { pLine.style.display = 'none'; }
    }
  });
})();

const DEFAULT_TRACKED = [
  '投資不踩雷', '鏡錶誌', '娛樂住海邊', '鏡爆點',
  '社會線上', '裴社長吃喝玩樂', '聲音筆記', '財經鏡來談', '鏡相人間'
];

const state = {
  files: [],            // [{name, rows: [...], dateMin, dateMax}]
  trackedKeywords: [],  // ['投資不踩雷', '鏡錶誌', ...]
  trackedEnabled: {},   // {投資不踩雷: true, ...}
  allRows: [],          // 全部 row(不論區間)
  dateOrigMin: null,    // 原始資料的最小日期
  dateOrigMax: null,    // 原始資料的最大日期
  filterFrom: null,     // 使用者選的區間 from
  filterTo: null,       // 使用者選的區間 to
  paidShows: new Set(), // 付費節目名稱
  showFilter: 'tracked',  // tracked | all
  showSearch: '',
  epSearch: '',
  sortShows: { by: 'listeners', dir: 'desc' },
  sortEps: { by: 'listeners', dir: 'desc' },
};

const charts = {};

// 載入儲存的追蹤節目清單(用 localStorage)
function loadTracked() {
  try {
    const saved = localStorage.getItem('mirrorLogTracked');
    if (saved) {
      const data = JSON.parse(saved);
      state.trackedKeywords = data.keywords || [...DEFAULT_TRACKED];
      state.trackedEnabled = data.enabled || {};
    } else {
      state.trackedKeywords = [...DEFAULT_TRACKED];
    }
  } catch (e) {
    state.trackedKeywords = [...DEFAULT_TRACKED];
  }
  // 確保每個 keyword 都有 enabled 狀態
  state.trackedKeywords.forEach(k => {
    if (!(k in state.trackedEnabled)) state.trackedEnabled[k] = true;
  });
  renderTrackedList();
}

function saveTracked() {
  try {
    localStorage.setItem('mirrorLogTracked', JSON.stringify({
      keywords: state.trackedKeywords,
      enabled: state.trackedEnabled,
    }));
  } catch (e) { /* ignore */ }
}

function renderTrackedList() {
  const wrap = document.getElementById('tracked-list');
  wrap.innerHTML = state.trackedKeywords.map(k => `
    <span class="tracked-tag ${state.trackedEnabled[k] ? 'active' : ''}" data-keyword="${escapeAttr(k)}">
      ${escapeHtml(k)}
      <span style="font-size:11px;opacity:0.6;margin-left:4px;cursor:pointer;" class="remove-keyword">✕</span>
    </span>
  `).join('');

  wrap.querySelectorAll('.tracked-tag').forEach(tag => {
    tag.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-keyword')) {
        const k = tag.dataset.keyword;
        state.trackedKeywords = state.trackedKeywords.filter(x => x !== k);
        delete state.trackedEnabled[k];
        saveTracked();
        renderTrackedList();
        return;
      }
      const k = tag.dataset.keyword;
      state.trackedEnabled[k] = !state.trackedEnabled[k];
      saveTracked();
      renderTrackedList();
    });
  });
}

document.getElementById('btn-add-show').addEventListener('click', () => {
  const input = document.getElementById('add-show-input');
  const v = input.value.trim();
  if (!v) return;
  if (state.trackedKeywords.includes(v)) {
    input.value = '';
    return;
  }
  state.trackedKeywords.push(v);
  state.trackedEnabled[v] = true;
  input.value = '';
  saveTracked();
  renderTrackedList();
});
document.getElementById('add-show-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-add-show').click();
});
document.getElementById('btn-toggle-all').addEventListener('click', () => {
  const anyActive = state.trackedKeywords.some(k => state.trackedEnabled[k]);
  state.trackedKeywords.forEach(k => state.trackedEnabled[k] = !anyActive);
  saveTracked();
  renderTrackedList();
});

// 初始化
document.addEventListener('DOMContentLoaded', loadTracked);
loadTracked();

// ============================================================
// 1. 上傳處理
// ============================================================
const fileInput = document.getElementById('file-input');
const uploadZone = document.getElementById('upload-zone');

fileInput.addEventListener('change', (e) => handleFiles([...e.target.files]));

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) handleFiles([...e.dataTransfer.files]);
});

async function handleFiles(fileList) {
  for (const file of fileList) {
    // 避免重複加入同名檔案
    if (state.files.find(f => f.name === file.name)) continue;
    try {
      const parsed = await parseXlsx(file);
      state.files.push({
        name: file.name,
        rows: parsed.rows,
        dateMin: parsed.dateMin,
        dateMax: parsed.dateMax,
      });
    } catch (err) {
      state.files.push({
        name: file.name,
        error: err.message || '解析失敗',
        rows: [],
      });
    }
  }
  renderFilesList();
  checkReady();
}

function parseXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true });
        const sheetName = wb.SheetNames[0];
        const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null, raw: false });

        if (rawRows.length === 0) {
          return reject(new Error('檔案沒有資料'));
        }

        // 驗證欄位
        const required = ['節目名稱', '單集名稱', '會員id', '會員類型', '收聽秒數', 'start_time'];
        const missing = required.filter(c => !(c in rawRows[0]));
        if (missing.length > 0) {
          return reject(new Error(`缺少必要欄位: ${missing.join(', ')}`));
        }

        // 解析並過濾髒資料
        const cleaned = [];
        for (const r of rawRows) {
          const startTime = parseDate(r.start_time);
          // 排除 1970 髒資料
          if (!startTime || startTime.getFullYear() < 2020) continue;

          cleaned.push({
            showName: String(r['節目名稱'] || '').trim(),
            episodeId: r['單集id'],
            episodeName: String(r['單集名稱'] || '').trim(),
            memberId: r['會員id'],
            memberType: String(r['會員類型'] || '').trim(),
            listenSeconds: parseInt(r['收聽秒數']) || 0,
            startTime: startTime,
            platform: String(r['收聽平台'] || '').trim(),
            isFreeShow: r['是否為免費節目'],
            albumCategory: String(r['專輯分類'] || '').trim(),
          });
        }

        if (cleaned.length === 0) {
          return reject(new Error('檔案沒有有效資料'));
        }

        const dates = cleaned.map(r => r.startTime).filter(Boolean);
        const dateMin = new Date(Math.min(...dates));
        const dateMax = new Date(Math.max(...dates));

        resolve({ rows: cleaned, dateMin, dateMax });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.readAsBinaryString(file);
  });
}

function renderFilesList() {
  const wrap = document.getElementById('files-list');
  if (state.files.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = state.files.map((f, i) => {
    if (f.error) {
      return `
        <div class="file-row error">
          <div class="file-name"><span class="file-icon">⚠</span>${escapeHtml(f.name)}</div>
          <div class="file-range">${escapeHtml(f.error)}</div>
          <div></div>
          <button class="file-remove" data-idx="${i}">✕</button>
        </div>
      `;
    }
    return `
      <div class="file-row">
        <div class="file-name"><span class="file-icon ok">●</span>${escapeHtml(f.name)}</div>
        <div class="file-range">${formatDate(f.dateMin)} → ${formatDate(f.dateMax)}</div>
        <div class="file-rows">${f.rows.length.toLocaleString()} 筆</div>
        <button class="file-remove" data-idx="${i}">✕</button>
      </div>
    `;
  }).join('');
  wrap.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      state.files.splice(parseInt(btn.dataset.idx), 1);
      renderFilesList();
      checkReady();
    });
  });
}

function checkReady() {
  const validFiles = state.files.filter(f => !f.error);
  document.getElementById('btn-generate').disabled = validFiles.length === 0;
}

// ============================================================
// 2. 工具函式
// ============================================================
function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  let d = new Date(s);
  if (!isNaN(d)) return d;
  return null;
}

function formatDate(d) {
  if (!d) return '—';
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function num(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toLocaleString('zh-TW');
}

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n) + '…' : s;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

// 判斷節目是否屬於某個追蹤關鍵字
function matchesTracked(showName, keyword) {
  return String(showName).includes(keyword);
}

// 取得節目對應的追蹤關鍵字(如果有)
function getTrackedKey(showName) {
  for (const k of state.trackedKeywords) {
    if (matchesTracked(showName, k)) return k;
  }
  return null;
}

// 判斷節目是否在「啟用的追蹤清單」內
function isTrackedAndEnabled(showName) {
  const k = getTrackedKey(showName);
  return k !== null && state.trackedEnabled[k];
}

// ============================================================
// 3. 產出報表
// ============================================================
document.getElementById('btn-generate').addEventListener('click', generateReport);
document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('確定要清除所有上傳的檔案?')) return;
  state.files = [];
  state.allRows = [];
  renderFilesList();
  checkReady();
});
document.getElementById('btn-back').addEventListener('click', () => {
  document.getElementById('report').classList.remove('active');
  document.getElementById('upload-section').style.display = 'block';
  window.scrollTo({top: 0, behavior: 'smooth'});
});

function generateReport() {
  // 合併所有檔案的 rows
  const all = [];
  for (const f of state.files) {
    if (!f.error) all.push(...f.rows);
  }
  state.allRows = all;

  if (all.length === 0) {
    alert('沒有有效資料');
    return;
  }

  // 建立付費節目集合(isFreeShow == 0 或 "0" 為付費)
  state.paidShows = new Set();
  for (const r of all) {
    if (String(r.isFreeShow) === '0' && r.showName) {
      state.paidShows.add(r.showName);
    }
  }

  // 原始區間
  const dates = all.map(r => r.startTime).filter(Boolean);
  state.dateOrigMin = new Date(Math.min(...dates));
  state.dateOrigMax = new Date(Math.max(...dates));

  // 預設 filter 用全部區間
  state.filterFrom = new Date(state.dateOrigMin);
  state.filterTo = new Date(state.dateOrigMax);

  // 填入 date input
  document.getElementById('filter-from').value = state.dateOrigMin.toISOString().slice(0, 10);
  document.getElementById('filter-to').value = state.dateOrigMax.toISOString().slice(0, 10);
  document.getElementById('filter-from').min = state.dateOrigMin.toISOString().slice(0, 10);
  document.getElementById('filter-from').max = state.dateOrigMax.toISOString().slice(0, 10);
  document.getElementById('filter-to').min = state.dateOrigMin.toISOString().slice(0, 10);
  document.getElementById('filter-to').max = state.dateOrigMax.toISOString().slice(0, 10);

  renderReport();
  document.getElementById('upload-section').style.display = 'none';
  document.getElementById('report').classList.add('active');
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// 區間 input 變化時即時重算
document.getElementById('filter-from').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v) {
    state.filterFrom = new Date(v);
    state.filterFrom.setHours(0, 0, 0, 0);
  }
  renderReport();
});
document.getElementById('filter-to').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v) {
    state.filterTo = new Date(v);
    state.filterTo.setHours(23, 59, 59, 999);
  }
  renderReport();
});
document.getElementById('btn-reset-range').addEventListener('click', () => {
  state.filterFrom = new Date(state.dateOrigMin);
  state.filterTo = new Date(state.dateOrigMax);
  document.getElementById('filter-from').value = state.dateOrigMin.toISOString().slice(0, 10);
  document.getElementById('filter-to').value = state.dateOrigMax.toISOString().slice(0, 10);
  renderReport();
});

// 取得當前區間內的 rows
function getFilteredRows() {
  if (!state.filterFrom || !state.filterTo) return state.allRows;
  const from = state.filterFrom.getTime();
  const to = state.filterTo.getTime();
  return state.allRows.filter(r => {
    const t = r.startTime?.getTime();
    return t !== undefined && t >= from && t <= to;
  });
}

// ============================================================
// 4. 渲染報表
// ============================================================
function renderReport() {
  // 套用區間 filter
  const rows = getFilteredRows();

  // 原始區間 + 套用後天數
  const origDays = Math.ceil((state.dateOrigMax - state.dateOrigMin) / 86400000) + 1;
  document.getElementById('range-text').textContent = `${formatDate(state.dateOrigMin)} — ${formatDate(state.dateOrigMax)}`;
  document.getElementById('range-days').textContent = `${origDays} 天`;
  document.getElementById('range-sources').textContent = `${state.files.filter(f => !f.error).length} 個檔案`;

  // 摘要(只計入追蹤節目)
  const trackedRows = rows.filter(r => isTrackedAndEnabled(r.showName));
  const trackedShowsSet = new Set(trackedRows.map(r => r.showName));
  const nonGuestRows = trackedRows.filter(r => r.memberType !== 'guest');
  const guestRows = trackedRows.filter(r => r.memberType === 'guest');
  const uniqueListeners = new Set(nonGuestRows.map(r => r.memberId)).size;
  const totalHours = Math.round(trackedRows.reduce((s, r) => s + r.listenSeconds, 0) / 3600);

  document.getElementById('sum-shows').textContent = num(trackedShowsSet.size);
  document.getElementById('sum-listeners').textContent = num(uniqueListeners);
  document.getElementById('sum-guest').textContent = num(guestRows.length);
  document.getElementById('sum-hours').textContent = num(totalHours);

  // 報表右上:收聽區間(使用者實際篩選範圍)+ 製表人
  const rf = state.filterFrom || state.dateOrigMin;
  const rt = state.filterTo || state.dateOrigMax;
  document.getElementById('report-range').textContent = `${formatDate(rf)} — ${formatDate(rt)}`;
  const producer = (document.getElementById('producer-name').value || '').trim();
  const pLine = document.getElementById('report-producer-line');
  if (producer) {
    document.getElementById('report-producer').textContent = producer;
    pLine.style.display = 'grid';
  } else {
    pLine.style.display = 'none';
  }

  // 觀察
  renderInsights(trackedRows);

  // 圖表
  renderCharts(rows, trackedRows);

  // 表格
  renderShowsTable();
  renderEpsTable();
}

function renderInsights(trackedRows) {
  const insights = [];

  // 觀察 1:追蹤節目集數
  const showStats = computeShowStats(trackedRows);
  const sorted = [...showStats].sort((a, b) => b.listeners - a.listeners);

  if (sorted.length === 0) {
    insights.push('<strong>追蹤節目清單裡沒有資料。</strong>請檢查上方「追蹤節目清單」是否有勾選節目,或上傳的 log 是否包含這些節目。');
  } else {
    // 第一名
    const top = sorted[0];
    insights.push(`本期<strong>${escapeHtml(top.name)}</strong>以 <strong>${num(top.listeners)}</strong> 位唯一會員聽眾、<strong>${num(top.plays)}</strong> 次播放,在追蹤節目中排第一。`);

    // 訪客比例
    const totalPlays = trackedRows.length;
    const guestPlays = trackedRows.filter(r => r.memberType === 'guest').length;
    const guestPct = totalPlays > 0 ? (guestPlays / totalPlays * 100).toFixed(1) : 0;
    if (guestPct > 40) {
      insights.push(`<strong>非會員(訪客)貢獻了 ${guestPct}% 的播放</strong>,代表大量流量是「未登入隨機聽聽」的瀏覽者。這群人是潛在的會員轉換目標,但我們無法追蹤他們是誰、聽多久。`);
    } else if (guestPct < 20) {
      insights.push(`非會員播放只佔 ${guestPct}%,本期收聽主要來自已登入會員 — 代表你的節目「死忠聽眾」比例高,但對「新訪客觸及」的能量較弱。`);
    } else {
      insights.push(`非會員播放佔 ${guestPct}%,跟會員播放算平衡。`);
    }

    // 付費聽眾
    const paidListeners = new Set(trackedRows.filter(r => r.memberType === 'subscriber').map(r => r.memberId)).size;
    const totalListeners = new Set(trackedRows.filter(r => r.memberType !== 'guest').map(r => r.memberId)).size;
    if (totalListeners > 0) {
      const paidPct = (paidListeners / totalListeners * 100).toFixed(0);
      insights.push(`追蹤節目本期共觸及 <strong>${num(totalListeners)} 位會員</strong>,其中 <strong>${num(paidListeners)} 位是付費訂閱者</strong>(${paidPct}%)。`);
    }

    // 只有訪客在聽的節目
    const orphan = showStats.filter(s => s.listeners === 0 && s.guestPlays > 0);
    if (orphan.length > 0) {
      const names = orphan.map(s => `「${s.name}」`).join('、');
      insights.push(`<strong>${names}</strong> 本期沒有任何會員聽,只有訪客點擊。可能代表該節目對既有會員缺乏吸引力,或是新流量還沒轉換成會員。`);
    }
  }

  document.getElementById('insights-list').innerHTML = insights.map(i => `<li>${i}</li>`).join('');
}

// ============================================================
// 5. 計算節目統計
// ============================================================
function computeShowStats(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.showName)) {
      map.set(r.showName, {
        name: r.showName,
        listeners: new Set(),
        paid: new Set(),
        general: new Set(),
        guestPlays: 0,
        memberPlays: 0,
        totalSeconds: 0,
        episodes: new Set(),
        category: r.albumCategory,
      });
    }
    const s = map.get(r.showName);
    if (r.memberType === 'guest') {
      s.guestPlays++;
    } else {
      s.memberPlays++;
      s.listeners.add(r.memberId);
      if (r.memberType === 'subscriber') s.paid.add(r.memberId);
      else if (r.memberType === 'general') s.general.add(r.memberId);
    }
    s.totalSeconds += r.listenSeconds;
    if (r.episodeId) s.episodes.add(r.episodeId);
  }

  return Array.from(map.values()).map(s => ({
    name: s.name,
    listeners: s.listeners.size,
    paid: s.paid.size,
    general: s.general.size,
    guestPlays: s.guestPlays,
    memberPlays: s.memberPlays,
    plays: s.guestPlays + s.memberPlays,
    hours: Math.round(s.totalSeconds / 3600 * 10) / 10,
    episodes: s.episodes.size,
    category: s.category,
  }));
}

function computeEpisodeStats(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.showName}__${r.episodeId}`;
    if (!map.has(key)) {
      map.set(key, {
        showName: r.showName,
        episodeId: r.episodeId,
        episodeName: r.episodeName,
        listeners: new Set(),
        plays: 0,
        totalSeconds: 0,
      });
    }
    const s = map.get(key);
    s.plays++;
    s.totalSeconds += r.listenSeconds;
    if (r.memberType !== 'guest') s.listeners.add(r.memberId);
  }
  return Array.from(map.values()).map(s => ({
    showName: s.showName,
    episodeId: s.episodeId,
    episodeName: s.episodeName,
    listeners: s.listeners.size,
    plays: s.plays,
    seconds: s.totalSeconds,
  }));
}

// ============================================================
// 6. 圖表
// ============================================================
function renderCharts(allRows, trackedRows) {
  Object.values(charts).forEach(c => c && c.destroy());

  Chart.defaults.font.family = "'Noto Sans TC', sans-serif";
  Chart.defaults.color = '#444';
  Chart.defaults.font.size = 12;

  const PALETTE = {
    paid: '#c8341a', general: '#1d9b54', guest: '#888',
    ios: '#2c5282', android: '#1d9b54', web: '#c8341a',
  };

  // 跨期趨勢:看是不是有多檔案(多週)
  const fileCount = state.files.filter(f => !f.error).length;
  if (fileCount >= 2) {
    renderTrendChart(trackedRows);
    document.getElementById('trend-block').style.display = 'block';
  } else {
    document.getElementById('trend-block').style.display = 'none';
  }

  // 聽眾類型結構
  const paid = trackedRows.filter(r => r.memberType === 'subscriber').length;
  const general = trackedRows.filter(r => r.memberType === 'general').length;
  const guest = trackedRows.filter(r => r.memberType === 'guest').length;

  charts.listenerType = new Chart(document.getElementById('chart-listener-type'), {
    type: 'doughnut',
    data: {
      labels: ['付費訂閱', '一般會員', '訪客(未登入)'],
      datasets: [{
        data: [paid, general, guest],
        backgroundColor: [PALETTE.paid, PALETTE.general, PALETTE.guest],
        borderColor: '#f5f1ea', borderWidth: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = paid + general + guest;
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${num(ctx.parsed)} 次播放 (${pct}%)`;
            }
          }
        }
      },
      cutout: '55%',
    }
  });

  // 收聽平台
  const platforms = {};
  trackedRows.forEach(r => {
    const p = r.platform || '未知';
    platforms[p] = (platforms[p] || 0) + 1;
  });
  const platformLabels = Object.keys(platforms);
  const platformData = Object.values(platforms);
  const platformColors = platformLabels.map(p => {
    if (p === 'ios') return PALETTE.ios;
    if (p === 'android') return PALETTE.android;
    if (p === 'web') return PALETTE.web;
    return '#888';
  });

  charts.platform = new Chart(document.getElementById('chart-platform'), {
    type: 'doughnut',
    data: {
      labels: platformLabels,
      datasets: [{
        data: platformData,
        backgroundColor: platformColors,
        borderColor: '#f5f1ea', borderWidth: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = platformData.reduce((a,b)=>a+b,0);
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${num(ctx.parsed)} (${pct}%)`;
            }
          }
        }
      },
      cutout: '55%',
    }
  });
}

function renderTrendChart(trackedRows) {
  // 按檔案區間切時段,計算每段的各節目唯一聽眾數
  const files = state.files.filter(f => !f.error);

  // 每個檔案算一個時段
  const periods = files.map(f => ({
    label: `${formatDate(f.dateMin)}\n~${formatDate(f.dateMax)}`,
    fileRows: f.rows.filter(r => isTrackedAndEnabled(r.showName)),
  }));

  // 取本期 TOP 6 節目(避免線太亂)
  const allShowStats = computeShowStats(trackedRows);
  const topShows = allShowStats.sort((a,b) => b.listeners - a.listeners).slice(0, 6).map(s => s.name);

  const COLORS = ['#c8341a', '#1d9b54', '#2c5282', '#7a5d00', '#8b5a2b', '#5e548e'];

  const datasets = topShows.map((showName, idx) => {
    const data = periods.map(p => {
      const ids = new Set(p.fileRows.filter(r => r.showName === showName && r.memberType !== 'guest').map(r => r.memberId));
      return ids.size;
    });
    return {
      label: truncate(showName, 14),
      data,
      borderColor: COLORS[idx % COLORS.length],
      backgroundColor: COLORS[idx % COLORS.length] + '20',
      tension: 0.3,
    };
  });

  charts.trend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: {
      labels: periods.map(p => p.label),
      datasets,
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', align: 'end', labels: { font: { size: 11 } } } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#e5dec9' }, title: { display: true, text: '唯一會員聽眾' } }
      }
    }
  });
}

// ============================================================
// 7. 節目表格
// ============================================================
function renderShowsTable() {
  const allRows = getFilteredRows();

  // 根據篩選計算
  let rows;
  if (state.showFilter === 'tracked') {
    rows = allRows.filter(r => isTrackedAndEnabled(r.showName));
  } else {
    rows = allRows;
  }

  let stats = computeShowStats(rows);

  // 搜尋過濾:空格分隔多關鍵字,符合任一個就顯示(與 Tool-1 一致)
  if (state.showSearch) {
    const terms = state.showSearch.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
      stats = stats.filter(s => {
        const name = s.name.toLowerCase();
        return terms.some(t => name.includes(t));
      });
    }
  }

  // 排序
  const { by, dir } = state.sortShows;
  stats.sort((a, b) => {
    const av = a[by] ?? 0;
    const bv = b[by] ?? 0;
    if (typeof av === 'string') {
      return dir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
    }
    return dir === 'desc' ? bv - av : av - bv;
  });

  const tbody = document.getElementById('shows-tbody');
  if (stats.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--ink-faint);">沒有資料</td></tr>';
  } else {
    tbody.innerHTML = stats.map(s => {
      const paidBadge = state.paidShows.has(s.name)
        ? '<span class="show-paid-badge">訂閱</span>'
        : '';
      return `
      <tr>
        <td class="show-name-cell">${escapeHtml(s.name)}${paidBadge}</td>
        <td class="num"><strong>${num(s.listeners)}</strong></td>
        <td class="num">${num(s.paid)}</td>
        <td class="num">${num(s.general)}</td>
        <td class="num">${num(s.guestPlays)}</td>
        <td class="num">${num(s.plays)}</td>
        <td class="num">${s.hours.toLocaleString()}</td>
        <td class="num">${num(s.episodes)}</td>
      </tr>
    `;
    }).join('');
  }

  // 排序視覺
  document.querySelectorAll('#shows-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === state.sortShows.by) {
      th.classList.add(state.sortShows.dir === 'desc' ? 'sort-desc' : 'sort-asc');
    }
  });
}

document.querySelectorAll('#shows-table th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (state.sortShows.by === col) {
      state.sortShows.dir = state.sortShows.dir === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortShows.by = col;
      state.sortShows.dir = 'desc';
    }
    renderShowsTable();
  });
});

document.getElementById('show-search').addEventListener('input', (e) => {
  state.showSearch = e.target.value.trim();
  renderShowsTable();
});

document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.showFilter = btn.dataset.filter;
    renderShowsTable();
  });
});

// ============================================================
// 8. 單集表格
// ============================================================
function renderEpsTable() {
  const allRows = getFilteredRows();
  const trackedRows = allRows.filter(r => isTrackedAndEnabled(r.showName));
  let stats = computeEpisodeStats(trackedRows);

  if (state.epSearch) {
    const terms = state.epSearch.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
      stats = stats.filter(s => {
        const show = s.showName.toLowerCase();
        const ep = s.episodeName.toLowerCase();
        return terms.some(t => show.includes(t) || ep.includes(t));
      });
    }
  }

  const { by, dir } = state.sortEps;
  stats.sort((a, b) => {
    const av = a[by] ?? 0;
    const bv = b[by] ?? 0;
    return dir === 'desc' ? bv - av : av - bv;
  });

  const tbody = document.getElementById('eps-tbody');
  if (stats.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--ink-faint);">沒有資料</td></tr>';
  } else {
    tbody.innerHTML = stats.slice(0, 200).map(s => {
      const paidBadge = state.paidShows.has(s.showName)
        ? '<span class="show-paid-badge">訂閱</span>'
        : '';
      return `
      <tr>
        <td>${escapeHtml(truncate(s.showName, 18))}${paidBadge}</td>
        <td>${escapeHtml(truncate(s.episodeName, 50))}</td>
        <td class="num"><strong>${num(s.listeners)}</strong></td>
        <td class="num">${num(s.plays)}</td>
        <td class="num">${num(s.seconds)}</td>
      </tr>
    `;
    }).join('');
    if (stats.length > 200) {
      tbody.innerHTML += `<tr><td colspan="5" style="text-align:center;padding:14px;color:var(--ink-faint);font-style:italic;">… 還有 ${stats.length - 200} 集未顯示,請用搜尋過濾</td></tr>`;
    }
  }

  document.querySelectorAll('#eps-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === state.sortEps.by) {
      th.classList.add(state.sortEps.dir === 'desc' ? 'sort-desc' : 'sort-asc');
    }
  });
}

document.querySelectorAll('#eps-table th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (state.sortEps.by === col) {
      state.sortEps.dir = state.sortEps.dir === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortEps.by = col;
      state.sortEps.dir = 'desc';
    }
    renderEpsTable();
  });
});

document.getElementById('ep-search').addEventListener('input', (e) => {
  state.epSearch = e.target.value.trim();
  renderEpsTable();
});

// ============================================================
// 9. 匯出
// ============================================================
document.getElementById('btn-print').addEventListener('click', () => window.print());
document.getElementById('btn-export-html').addEventListener('click', exportStandaloneHTML);

async function exportStandaloneHTML() {
  if (state.allRows.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  // 報表產出時間(本地時區,清楚格式,與 Tool-1 一致)
  const _now = new Date();
  const _p = n => String(n).padStart(2, '0');
  const exportTimeStr = `${_now.getFullYear()}/${_p(_now.getMonth()+1)}/${_p(_now.getDate())} ${_p(_now.getHours())}:${_p(_now.getMinutes())}`;
  // 用使用者目前篩選的區間,而不是 allRows
  const filteredRows = getFilteredRows();
  const trackedRows = filteredRows.filter(r => isTrackedAndEnabled(r.showName));
  const showStats = computeShowStats(trackedRows);
  const epStats = computeEpisodeStats(trackedRows);

  // 區間用使用者選的
  const dateMin = state.filterFrom || state.dateOrigMin;
  const dateMax = state.filterTo || state.dateOrigMax;

  // 抓 Chart.js inline
  let chartJsCode = '';
  try {
    const resp = await fetch('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js');
    chartJsCode = await resp.text();
  } catch (e) { /* fallback to CDN */ }

  const chartScript = chartJsCode
    ? `<script>${chartJsCode}<\/script>`
    : `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>`;

  // 抓樣式
  const styleEl = document.querySelector('style').cloneNode(true);

  // 抓報表 DOM
  const reportSection = document.getElementById('report').cloneNode(true);
  reportSection.querySelectorAll('.no-print').forEach(el => el.remove());
  reportSection.removeAttribute('id');
  reportSection.classList.add('active');
  reportSection.style.display = 'block';

  const totalPaid = trackedRows.filter(r => r.memberType === 'subscriber').length;
  const totalGeneral = trackedRows.filter(r => r.memberType === 'general').length;
  const totalGuest = trackedRows.filter(r => r.memberType === 'guest').length;

  const platforms = {};
  trackedRows.forEach(r => {
    const p = r.platform || '未知';
    platforms[p] = (platforms[p] || 0) + 1;
  });

  const html = `<!DOCTYPE html>
<html lang="zh-Hant"><head>
<meta charset="UTF-8">
<title>鏡好聽 Log 分析_${today}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;600;900&family=Noto+Sans+TC:wght@300;400;500;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
${chartScript}
${styleEl.outerHTML}
<style>
  body { background: var(--paper); }
  .standalone-header { border-bottom: 3px double var(--ink); padding-bottom: 28px; margin-bottom: 40px; }
  .standalone-header .top { display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--ink-faint); margin-bottom: 18px; }
  .standalone-header h1 { font-family: 'Noto Serif TC', serif; font-weight: 900; font-size: 50px; letter-spacing: -0.02em; line-height: 1.05; margin-bottom: 12px; }
  .standalone-header .sub { font-family: 'Noto Serif TC', serif; font-style: italic; font-size: 18px; color: var(--ink-soft); }
  .standalone-footer { margin-top: 80px; padding-top: 24px; border-top: 1px solid var(--line); font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.1em; color: var(--ink-faint); text-align: center; line-height: 1.8; }
  th.sortable { cursor: pointer; }
</style>
</head><body>
<div class="container">
  <header class="standalone-header">
    <div class="top">
      <span>鏡好聽專用</span>
      <span>報表產出時間 ${exportTimeStr}</span>
    </div>
    <h1>鏡好聽平台<br>收聽分析報告</h1>
  </header>
  ${reportSection.outerHTML}
  <footer class="standalone-footer">本報表為靜態快照,資料為產出當下的數值。</footer>
</div>

<script>
const SHOW_STATS = ${JSON.stringify(showStats)};
const EP_STATS = ${JSON.stringify(epStats.slice(0, 500))};
const TYPE_DATA = { paid: ${totalPaid}, general: ${totalGeneral}, guest: ${totalGuest} };
const PLATFORM_DATA = ${JSON.stringify(platforms)};
const PAID_SHOWS = new Set(${JSON.stringify([...state.paidShows])});

function num(n) { if (n === null || n === undefined || isNaN(n)) return '—'; return n.toLocaleString('zh-TW'); }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : s; }

Chart.defaults.font.family = "'Noto Sans TC', sans-serif";
Chart.defaults.color = '#444';
Chart.defaults.font.size = 12;

// 聽眾類型
new Chart(document.getElementById('chart-listener-type'), {
  type: 'doughnut',
  data: {
    labels: ['付費訂閱', '一般會員', '訪客(未登入)'],
    datasets: [{
      data: [TYPE_DATA.paid, TYPE_DATA.general, TYPE_DATA.guest],
      backgroundColor: ['#c8341a', '#1d9b54', '#888'],
      borderColor: '#f5f1ea', borderWidth: 3,
    }]
  },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } }, cutout: '55%' }
});

// 平台
const pLabels = Object.keys(PLATFORM_DATA);
const pData = Object.values(PLATFORM_DATA);
const pColors = pLabels.map(p => p === 'ios' ? '#2c5282' : p === 'android' ? '#1d9b54' : p === 'web' ? '#c8341a' : '#888');
new Chart(document.getElementById('chart-platform'), {
  type: 'doughnut',
  data: { labels: pLabels, datasets: [{ data: pData, backgroundColor: pColors, borderColor: '#f5f1ea', borderWidth: 3 }] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } }, cutout: '55%' }
});

// 表格排序
const sortShowState = { by: 'listeners', dir: 'desc' };
const sortEpState = { by: 'listeners', dir: 'desc' };

function renderShows() {
  const sorted = [...SHOW_STATS].sort((a, b) => {
    const av = a[sortShowState.by] ?? 0, bv = b[sortShowState.by] ?? 0;
    return sortShowState.dir === 'desc' ? bv - av : av - bv;
  });
  document.getElementById('shows-tbody').innerHTML = sorted.map(s => {
    const badge = PAID_SHOWS.has(s.name) ? '<span class="show-paid-badge">訂閱</span>' : '';
    return '<tr><td class="show-name-cell">' + escapeHtml(s.name) + badge + '</td>' +
      '<td class="num"><strong>' + num(s.listeners) + '</strong></td>' +
      '<td class="num">' + num(s.paid) + '</td>' +
      '<td class="num">' + num(s.general) + '</td>' +
      '<td class="num">' + num(s.guestPlays) + '</td>' +
      '<td class="num">' + num(s.plays) + '</td>' +
      '<td class="num">' + s.hours.toLocaleString() + '</td>' +
      '<td class="num">' + num(s.episodes) + '</td></tr>';
  }).join('');
  document.querySelectorAll('#shows-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortShowState.by) th.classList.add(sortShowState.dir === 'desc' ? 'sort-desc' : 'sort-asc');
  });
}
document.querySelectorAll('#shows-table th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (sortShowState.by === col) sortShowState.dir = sortShowState.dir === 'desc' ? 'asc' : 'desc';
    else { sortShowState.by = col; sortShowState.dir = 'desc'; }
    renderShows();
  });
});
renderShows();

function renderEps() {
  const sorted = [...EP_STATS].sort((a, b) => {
    const av = a[sortEpState.by] ?? 0, bv = b[sortEpState.by] ?? 0;
    return sortEpState.dir === 'desc' ? bv - av : av - bv;
  });
  document.getElementById('eps-tbody').innerHTML = sorted.slice(0, 200).map(s => {
    const badge = PAID_SHOWS.has(s.showName) ? '<span class="show-paid-badge">訂閱</span>' : '';
    return '<tr><td>' + escapeHtml(truncate(s.showName, 18)) + badge + '</td>' +
      '<td>' + escapeHtml(truncate(s.episodeName, 50)) + '</td>' +
      '<td class="num"><strong>' + num(s.listeners) + '</strong></td>' +
      '<td class="num">' + num(s.plays) + '</td>' +
      '<td class="num">' + num(s.seconds) + '</td></tr>';
  }).join('');
  document.querySelectorAll('#eps-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortEpState.by) th.classList.add(sortEpState.dir === 'desc' ? 'sort-desc' : 'sort-asc');
  });
}
document.querySelectorAll('#eps-table th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (sortEpState.by === col) sortEpState.dir = sortEpState.dir === 'desc' ? 'asc' : 'desc';
    else { sortEpState.by = col; sortEpState.dir = 'desc'; }
    renderEps();
  });
});
renderEps();
<\/script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `鏡好聽log_${today}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

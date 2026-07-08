/**
 * 鏡好聽節目組 — 收聽數據彙整表(Google Apps Script)
 *
 * 用途:接收 tool-1 報表產出時上傳的「摘要數字」,寫進這張試算表,
 *      並提供一個給主管看的「所有節目總覽」網頁(doGet)。
 *
 * ── 安裝步驟(照做即可,不用會寫程式)──────────────────────────
 * 1. 開一個新的 Google 試算表(名稱隨意,例如「節目收聽數據彙整」)。
 * 2. 上方選單「擴充功能」→「Apps Script」。
 * 3. 把這整份檔案的內容貼進去(取代原本的 myFunction),存檔。
 * 4. 把下面 TOKEN 的值改成你自己想的通行碼(隨便一串英數字,越長越好)。
 * 5. 右上「部署」→「新增部署作業」→ 類型選「網路應用程式」:
 *      - 執行身分:我
 *      - 具有存取權的使用者:任何人
 *    按「部署」,複製產生的「網路應用程式 URL」。
 * 6. 把這個 URL 和通行碼填進 tool-1 的「彙整表設定」。
 * 7. 主管看總覽:直接開同一個 URL(瀏覽器打開就是總覽頁),
 *    或直接看這張試算表本身。
 *
 * ── 資料放哪 ──────────────────────────────────────────────
 * 「上傳紀錄」分頁:每次上傳追加一列(保留歷史,可自行畫圖表)。
 * 「最新總覽」分頁:每個節目一列,永遠是最近一次上傳的數字。
 *
 * ── 安全性 ────────────────────────────────────────────────
 * 通行碼擋的是「亂寫入」。總覽頁(doGet)不需通行碼即可看,
 * 若要限制觀看,部署時把存取權改成「僅限貴機構使用者」即可。
 */

const TOKEN = '請把這串換成你自己的通行碼';

const LOG_SHEET = '上傳紀錄';
const LATEST_SHEET = '最新總覽';
const HEADERS = [
  '上傳時間', '節目名稱', '製表人', '分析區間起', '分析區間迄',
  '期間集數', '期間總收聽', '開播至今總收聽', '開播至今單集平均', '平均計入集數',
  '上月標籤', '上月總收聽', 'Apple累積', 'Spotify累積', 'YouTube累積',
  'Apple訂閱', 'Spotify追蹤', 'YouTube訂閱', '總集數',
];

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: '收到的不是合法 JSON' });
  }
  if (!data || data.token !== TOKEN) {
    return jsonOut({ ok: false, error: '通行碼不符' });
  }
  if (!data.show) {
    return jsonOut({ ok: false, error: '缺節目名稱' });
  }

  const row = [
    new Date(), data.show, data.producer || '', data.periodFrom || '', data.periodTo || '',
    data.episodesInPeriod || 0, data.periodPlays || 0, data.allTimePlays || 0,
    data.allTimeAvg || 0, data.allTimeAvgCount || 0,
    data.lastMonthLabel || '', data.lastMonthPlays || 0,
    data.appleTotal || 0, data.spotifyTotal || 0, data.ytTotal || 0,
    data.subApple || '', data.subSpotify || '', data.subYt || '',
    data.totalEpisodes || 0,
  ];

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = getOrCreateSheet(ss, LOG_SHEET);
  log.appendRow(row);

  // 最新總覽:同名節目就整列覆蓋,沒有就新增
  const latest = getOrCreateSheet(ss, LATEST_SHEET);
  const names = latest.getRange(2, 2, Math.max(latest.getLastRow() - 1, 1), 1).getValues().map(r => r[0]);
  const idx = names.indexOf(data.show);
  if (idx >= 0) {
    latest.getRange(idx + 2, 1, 1, row.length).setValues([row]);
  } else {
    latest.appendRow(row);
  }

  return jsonOut({ ok: true });
}

function doGet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const latest = getOrCreateSheet(ss, LATEST_SHEET);
  const lastRow = latest.getLastRow();
  const rows = lastRow > 1 ? latest.getRange(2, 1, lastRow - 1, HEADERS.length).getValues() : [];

  // 依最後上傳時間新→舊
  rows.sort((a, b) => new Date(b[0]) - new Date(a[0]));

  const fmtN = n => (typeof n === 'number' ? n.toLocaleString('zh-TW') : (n || '—'));
  const fmtD = d => {
    if (!(d instanceof Date)) return d || '—';
    const p = x => String(x).padStart(2, '0');
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  const trs = rows.map(r => `
    <tr>
      <td class="show">${esc(r[1])}<div class="sub">${esc(r[2] || '')}</div></td>
      <td>${fmtD(r[0])}</td>
      <td class="num strong">${fmtN(r[7])}</td>
      <td class="num">${fmtN(r[8])}</td>
      <td class="num">${fmtN(r[11])}<div class="sub">${esc(r[10] || '')}</div></td>
      <td class="num">${fmtN(r[12])}</td>
      <td class="num">${fmtN(r[13])}</td>
      <td class="num">${fmtN(r[14])}</td>
      <td class="num">${fmtN(r[18])}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>節目收聽數據總覽</title>
<style>
  body { font-family: "Noto Sans TC", sans-serif; background: #f5f1ea; color: #1a1a1a; margin: 0; padding: 40px 24px; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .note { font-size: 13px; color: #8a8377; margin-bottom: 24px; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; background: #fff; font-size: 13px; }
  th { background: #1a1a1a; color: #f5f1ea; padding: 10px 12px; text-align: left; font-weight: 500; white-space: nowrap; }
  th.num, td.num { text-align: right; }
  td { padding: 10px 12px; border-bottom: 1px solid #e5dec9; vertical-align: top; }
  td.show { font-weight: 700; }
  td.strong { font-weight: 700; }
  .sub { font-size: 11px; color: #8a8377; font-weight: 400; margin-top: 2px; }
  .empty { padding: 40px; text-align: center; color: #8a8377; background: #fff; border: 1px solid #e5dec9; }
</style></head><body><div class="wrap">
<h1>節目收聽數據總覽</h1>
<div class="note">
  各節目最近一次報表上傳的摘要數字。歷史紀錄在試算表的「上傳紀錄」分頁。<br>
  <strong>注意:各平台與各節目的數字計算邏輯不同,只能看單一節目自己的變化,不能跨節目、跨平台相加或排名比較。</strong>
</div>
${rows.length === 0 ? '<div class="empty">還沒有任何節目上傳資料</div>' : `
<table>
  <tr>
    <th>節目 / 製表人</th><th>最後上傳</th>
    <th class="num">開播至今總收聽</th><th class="num">單集平均</th><th class="num">上月總收聽</th>
    <th class="num">Apple 累積</th><th class="num">Spotify 累積</th><th class="num">YouTube 累積</th><th class="num">總集數</th>
  </tr>
  ${trs}
</table>`}
</div></body></html>`;

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getOrCreateSheet(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

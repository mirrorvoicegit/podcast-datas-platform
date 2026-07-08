// tool-1 端對端驗證:假資料 → 完整流程 → 報表檢查 → 匯出檔再檢查一次。
// 跑法:npm install && node make-fixtures.js && node verify.js
// 詳見 README.md。任何檢查失敗會以非零碼結束,輸出與截圖在 out/。
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const FIX = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// 沙盒連不到 CDN:把 index.html 的 CDN 引用換成 node_modules 的本機檔,放進暫存副本
function makeLocalCopy() {
  const src = path.join(__dirname, '..', 'tool-1');
  const dst = path.join(OUT, 'tool1copy');
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(src, 'app.js'), path.join(dst, 'app.js'));
  // chart.js 的 package exports 不含 dist 路徑,直接組實體路徑
  fs.copyFileSync(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), path.join(dst, 'chart.umd.min.js'));
  fs.copyFileSync(path.join(__dirname, 'node_modules', 'papaparse', 'papaparse.min.js'), path.join(dst, 'papaparse.min.js'));
  let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  html = html
    .replace(/https:\/\/cdnjs\.cloudflare\.com\/[^"]*papaparse[^"]*/g, 'papaparse.min.js')
    .replace(/https:\/\/cdn\.jsdelivr\.net\/[^"]*chart[^"]*/g, 'chart.umd.min.js');
  fs.writeFileSync(path.join(dst, 'index.html'), html);
  return path.join(dst, 'index.html');
}

const failures = [];
function check(name, cond, detail) {
  const ok = !!cond;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

async function runFlow(page) {
  await page.setInputFiles('#file-all', ['apple.csv', 'spotify.csv', 'youtube.csv'].map(f => path.join(FIX, f)));
  await page.waitForTimeout(1200);
  await page.selectOption('#period-select', 'all');
  await page.click('#btn-generate');
  await page.waitForTimeout(600);
  if (await page.isVisible('#fuzzy-section')) { await page.click('#btn-fuzzy-next'); await page.waitForTimeout(600); }
  if (await page.isVisible('#orphan-section')) { await page.click('#btn-final-generate'); await page.waitForTimeout(600); }
  await page.waitForSelector('#report.active', { timeout: 5000 });
  await page.waitForTimeout(1200);
}

// 報表內容檢查(畫面版與匯出版共用)
async function inspect(page) {
  return page.evaluate(() => {
    const out = {};
    const trend = Chart.getChart(document.getElementById('chart-trend'));
    out.trendLegend = trend ? trend.legend.legendItems.map(i => ({ text: i.text, fill: String(i.fillStyle) })) : null;
    const at = Chart.getChart(document.getElementById('chart-ranking-alltime'));
    out.alltimeLabels = at ? at.data.labels.length : -1;
    out.matchSummaryText = document.getElementById('match-summary').innerText;
    out.headerCount = document.querySelectorAll('#data-table thead th').length;
    out.rowCells = document.querySelector('#data-tbody tr') ? document.querySelector('#data-tbody tr').querySelectorAll('td').length : -1;
    out.cmpUp = document.querySelectorAll('#data-tbody .cmp-avg.up').length;
    out.cmpDown = document.querySelectorAll('#data-tbody .cmp-avg.down').length;
    out.rows = document.querySelectorAll('#data-tbody tr').length;
    out.cmpDash = [...document.querySelectorAll('#data-tbody tr')].filter(tr => {
      const tds = tr.querySelectorAll('td');
      return tds[6] && tds[6].innerText.trim() === '—';
    }).length;
    return out;
  });
}

function assertReport(r, label) {
  check(`${label}:趨勢圖圖例有三個平台`, r.trendLegend && r.trendLegend.length === 3);
  const badFill = (r.trendLegend || []).filter(i => !/^#[0-9a-f]{8}$/i.test(i.fill) && !/^rgba/.test(i.fill));
  check(`${label}:圖例填色都是合法色碼`, badFill.length === 0, badFill.map(i => i.text + '=' + i.fill).join(', '));
  check(`${label}:開播至今 TOP10 圖有 10 筆`, r.alltimeLabels === 10, 'labels=' + r.alltimeLabels);
  check(`${label}:橫排數字有開播至今單集平均`, r.matchSummaryText.includes('開播至今單集平均'));
  check(`${label}:表頭 8 欄、資料列 8 格`, r.headerCount === 8 && r.rowCells === 8, `th=${r.headerCount} td=${r.rowCells}`);
  check(`${label}:比較欄有紅升也有綠降`, r.cmpUp > 0 && r.cmpDown > 0, `up=${r.cmpUp} down=${r.cmpDown}`);
  check(`${label}:缺平台的集數顯示 —`, r.cmpDash > 0, `dash=${r.cmpDash}`);
}

(async () => {
  const indexPath = makeLocalCopy();
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('file://' + indexPath);
  await runFlow(page);
  check('畫面版:全程無 JS 例外', errors.length === 0, errors.join('; '));
  const live = await inspect(page);
  assertReport(live, '畫面版');

  // 平均交叉驗證:期間=開播至今、孤兒全保留時,state.merged 就是完整資料集,可用另一條路徑重算
  const cross = await page.evaluate(() => {
    const complete = state.merged.filter(d => (state.uploadedPlatforms || []).every(p => d[p] !== null));
    const avg = complete.length ? Math.round(complete.reduce((s, d) => s + d.total, 0) / complete.length) : 0;
    return { crossAvg: avg, stateAvg: state.allTimeAvg };
  });
  check('畫面版:單集平均交叉驗證一致', cross.crossAvg === cross.stateAvg, JSON.stringify(cross));

  await page.screenshot({ path: path.join(OUT, 'report.png'), fullPage: true });

  // 匯出檔驗證
  const dlPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#btn-export-html');
  const dl = await dlPromise;
  const exportPath = path.join(OUT, 'export.html');
  await dl.saveAs(exportPath);

  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(e.message));
  await page2.route('**cdn.jsdelivr.net/**', route =>
    route.fulfill({ path: path.join(OUT, 'tool1copy', 'chart.umd.min.js'), contentType: 'application/javascript' }));
  await page2.route('**fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page2.route('**fonts.gstatic.com/**', r => r.abort());
  await page2.goto('file://' + exportPath);
  await page2.waitForTimeout(2000);
  check('匯出版:全程無 JS 例外', errors2.length === 0, errors2.join('; '));
  const exported = await inspect(page2);
  assertReport(exported, '匯出版');
  await page2.screenshot({ path: path.join(OUT, 'export.png'), fullPage: true });

  await browser.close();
  console.log(failures.length === 0
    ? '\n全部通過。截圖在 dev/out/,交付前記得仍要提醒維護者用真瀏覽器看一眼。'
    : `\n${failures.length} 項失敗:${failures.join(' / ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

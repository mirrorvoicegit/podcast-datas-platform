// AI 觀點(Gemini)功能驗證:mock generativelanguage.googleapis.com,不會真的呼叫 Gemini、不花錢。
// 只驗證前端邏輯(payload 組成、UI 狀態、匯出凍結行為),不驗證 Gemini API 本身的真實回應格式——
// 這段程式從沒在真的 API 上測過(開發沙盒連不到外網),交付前務必請維護者用真的 key 實測一次。
// 跑法:cd dev && node make-fixtures.js && node verify-ai.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const FIX = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'out');
const MOCK_TEXT = '這是 mock 回傳的 AI 觀點文字,用來驗證前端渲染與凍結邏輯是否正確運作。';

function makeLocalCopy() {
  const src = path.join(__dirname, '..', 'tool-1');
  const dst = path.join(OUT, 'tool1copy');
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(src, 'app.js'), path.join(dst, 'app.js'));
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

async function runFlow(page, showName) {
  await page.fill('#show-name', showName);
  await page.setInputFiles('#file-all', ['apple.csv', 'spotify.csv', 'youtube.csv'].map(f => path.join(FIX, f)));
  await page.waitForTimeout(1000);
  await page.selectOption('#period-select', 'all');
  await page.click('#btn-generate');
  await page.waitForTimeout(500);
  if (await page.isVisible('#fuzzy-section')) { await page.click('#btn-fuzzy-next'); await page.waitForTimeout(500); }
  if (await page.isVisible('#orphan-section')) { await page.click('#btn-final-generate'); await page.waitForTimeout(500); }
  await page.waitForSelector('#report.active', { timeout: 5000 });
  await page.waitForTimeout(800);
}

(async () => {
  const indexPath = makeLocalCopy();
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  let receivedBody = null, receivedUrl = null;
  await page.route('**generativelanguage.googleapis.com/**', route => {
    receivedUrl = route.request().url();
    receivedBody = JSON.parse(route.request().postData());
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: MOCK_TEXT }] } }] }) });
  });

  await page.goto('file://' + indexPath);
  await runFlow(page, 'AI測試節目');
  check('全程無 JS 例外', errors.length === 0, errors.join('; '));

  // 未設定金鑰:應打開設定面板、給提示、不呼叫 API
  await page.click('#btn-ai-generate');
  await page.waitForTimeout(300);
  check('未設定金鑰時不呼叫 API', receivedBody === null);
  check('未設定金鑰時打開設定面板', await page.isVisible('#ai-settings'));

  // 設定金鑰 → 產生
  await page.fill('#ai-key', 'FAKE_KEY_verify');
  await page.selectOption('#ai-model', 'gemini-2.5-pro');
  await page.click('#btn-ai-save');
  await page.click('#btn-ai-generate');
  await page.waitForTimeout(500);
  check('產生後顯示輸出區', await page.isVisible('#ai-output'));
  check('文字內容正確渲染', (await page.textContent('#ai-text')) === MOCK_TEXT);
  check('呼叫網址帶對模型與金鑰', receivedUrl && receivedUrl.includes('gemini-2.5-pro') && receivedUrl.includes('FAKE_KEY_verify'));

  const promptText = receivedBody ? receivedBody.contents[0].parts[0].text : '';
  check('prompt 含節目名稱', promptText.includes('AI測試節目'));
  check('prompt 含開播至今單集平均', promptText.includes('開播至今單集平均'));
  check('prompt 含單集標題列表', /\d+\. .+｜Apple:/.test(promptText));

  // 匯出:應凍結文字、拿掉互動控制項
  const dlPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#btn-export-html');
  const dl = await dlPromise;
  const exportPath = path.join(OUT, 'export_ai.html');
  await dl.saveAs(exportPath);

  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page2.route('**cdn.jsdelivr.net/**', route => route.fulfill({ path: path.join(OUT, 'tool1copy', 'chart.umd.min.js'), contentType: 'application/javascript' }));
  await page2.route('**fonts.g*/**', r => r.abort());
  await page2.goto('file://' + exportPath);
  await page2.waitForTimeout(1200);
  const exportCheck = await page2.evaluate(() => ({
    hasAiText: document.body.innerText.includes('這是 mock 回傳的 AI 觀點文字'),
    hasGenerateBtn: !!document.getElementById('btn-ai-generate'),
    hasDisclaimer: document.body.innerText.includes('僅供參考'),
  }));
  check('匯出版有凍結 AI 文字', exportCheck.hasAiText);
  check('匯出版沒有互動按鈕', !exportCheck.hasGenerateBtn);
  check('匯出版有免責提示', exportCheck.hasDisclaimer);
  await page2.screenshot({ path: path.join(OUT, 'ai_export.png'), fullPage: true });

  // 沒產生過 AI 觀點時,匯出檔不該留空殼
  const page3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page3.goto('file://' + indexPath);
  await runFlow(page3, '無AI測試');
  const dl2Promise = page3.waitForEvent('download', { timeout: 30000 });
  await page3.click('#btn-export-html');
  const dl2 = await dl2Promise;
  const exportPath2 = path.join(OUT, 'export_noai.html');
  await dl2.saveAs(exportPath2);
  const page4 = await browser.newPage();
  await page4.route('**cdn.jsdelivr.net/**', route => route.fulfill({ path: path.join(OUT, 'tool1copy', 'chart.umd.min.js'), contentType: 'application/javascript' }));
  await page4.route('**fonts.g*/**', r => r.abort());
  await page4.goto('file://' + exportPath2);
  await page4.waitForTimeout(1000);
  const noAiCheck = await page4.evaluate(() => ({
    hasAiBlock: !!document.getElementById('ai-insight-block'),
  }));
  check('沒產生 AI 觀點時匯出檔不留空殼', !noAiCheck.hasAiBlock);

  await browser.close();
  console.log(failures.length === 0
    ? '\n全部通過(僅驗證前端邏輯,未打真實 Gemini API,交付前請維護者用真金鑰測一次)。'
    : `\n${failures.length} 項失敗:${failures.join(' / ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

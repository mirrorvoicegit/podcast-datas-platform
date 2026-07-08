// 產生假資料 CSV(fixtures/),模擬三平台後台匯出檔的真實格式與邊角情況。
// 資料全部虛構,只是格式與真檔一致。跑法:node make-fixtures.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

// 30 集,每週二上架,從 2025-09-02 開始
const episodes = [];
const start = new Date(2025, 8, 2); // 2025-09-02
for (let i = 0; i < 30; i++) {
  const d = new Date(start);
  d.setDate(start.getDate() + i * 7);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  episodes.push({
    n: i + 1,
    title: `第${i + 1}集：測試節目主題${i + 1}｜${ymd.replace(/-/g, '.')}`,
    date: d,
    ymd,
    apple: 500 + ((i * 137) % 900),
    spotify: 400 + ((i * 89) % 700),
    yt: 300 + ((i * 211) % 1500),
  });
}

// 邊角情況設定
const YT_TITLE_DIFF = new Set([3, 7]);   // 這幾集 YouTube 標題不同(觸發可疑配對)
const NO_YT = new Set([5, 12]);           // 這幾集沒有 YouTube(缺平台,平均比較該顯示 —)
const NO_APPLE = new Set([20]);           // 這集只有 Spotify+YouTube
const enUS = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// --- Apple:Show Name,...,Episode Title,Release Date,Duration,...,Plays,... ---
let apple = 'Show Name,Episode ID,Episode GUID,Episode Number,Episode Title,Release Date,Duration,Unique Listeners,Unique Engaged Listeners,Plays,Average Consumption\n';
episodes.forEach(e => {
  if (NO_APPLE.has(e.n)) return;
  apple += `"測試節目",${1000 + e.n},"guid-${e.n}",NaN,"${e.title}",${e.ymd},1200,${Math.round(e.apple * 0.7)},${Math.round(e.apple * 0.5)},${e.apple},0.8\n`;
});
fs.writeFileSync(path.join(OUT, 'apple.csv'), apple);

// --- Spotify:"name","plays","streams","audience_size","releaseDate" ---
let spotify = '"name","plays","streams","audience_size","releaseDate"\n';
episodes.forEach(e => {
  spotify += `"${e.title}","${e.spotify}","${Math.round(e.spotify * 0.9)}","${Math.round(e.spotify * 0.8)}","${e.ymd}"\n`;
});
fs.writeFileSync(path.join(OUT, 'spotify.csv'), spotify);

// --- YouTube:內容,影片標題,影片發布時間,時間長度,觀看次數(含總計列與 Shorts) ---
let yt = '內容,影片標題,影片發布時間,時間長度,觀看次數\n';
const ytRows = [];
let ytTotal = 0;
episodes.forEach(e => {
  if (NO_YT.has(e.n)) return;
  const title = YT_TITLE_DIFF.has(e.n)
    ? `【完整版】測試節目主題${e.n} 深度解析 EP${e.n}`  // 標題故意不同
    : e.title;
  ytRows.push(`vid${String(e.n).padStart(3, '0')},${JSON.stringify(title)},"${enUS(e.date)}",1350,${e.yt}`);
  ytTotal += e.yt;
});
// Shorts(時長 60 秒,該被門檻排除)
ytRows.push(`vidS01,"📈測試 Shorts 短影音一","${enUS(episodes[10].date)}",60,9999`);
ytRows.push(`vidS02,"📈測試 Shorts 短影音二","${enUS(episodes[15].date)}",45,8888`);
ytTotal += 9999 + 8888;
yt += `總計,,,,${ytTotal}\n` + ytRows.join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'youtube.csv'), yt);

console.log('fixtures 已產生:', fs.readdirSync(OUT).join(', '));
console.log('集數 30,其中 YouTube 標題不同:', [...YT_TITLE_DIFF].join(','),
  '/ 缺 YouTube:', [...NO_YT].join(','), '/ 缺 Apple:', [...NO_APPLE].join(','));

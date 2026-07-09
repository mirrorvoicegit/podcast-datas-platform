# dev/ — 自動驗證工具（給維護的 AI 模型用，不影響線上工具）

這個資料夾**不是**分析工具的一部分，是留給「接手維護的 AI 模型」的自動化驗證配備。
改完 tool-1 之後，不必用肉眼猜圖表有沒有壞——跑一次腳本，它會用假資料走完整個流程，
把報表和匯出檔都實際渲染出來、檢查關鍵元素、存下截圖。

## 為什麼需要它

CLAUDE.md 鐵律 7 說「AI 看不到渲染結果」。這套腳本就是解法：
用無頭瀏覽器（Chromium）真的把頁面跑起來，AI 可以讀截圖、讀檢查輸出，
在交付前自己抓到「圖例消失」「欄位錯位」這類肉眼型 bug。

## 使用方式（在有 Node.js 與 Chromium 的環境）

```bash
cd dev
npm install                 # 安裝 playwright-core + chart.js + papaparse（僅本資料夾用）
node make-fixtures.js       # 產生假資料 CSV（fixtures/，已被 .gitignore 擋住不會進版本庫）
node verify.js              # 跑完整流程 + 檢查 + 截圖（輸出在 out/）
```

- 若環境的 Chromium 不在預設位置，用環境變數指定：`CHROMIUM=/path/to/chromium node verify.js`
- 沙盒環境通常連不到 CDN，verify.js 會自動把 index.html 裡的 CDN 引用換成
  node_modules 裡的本機檔（在暫存副本上做，不動原始碼）。

## 檢查了什麼

1. 三平台 CSV 上傳 → 比對 → 報表產出，全程無 JS 例外。
2. 趨勢線圖例三個平台都在、填色是合法色碼（v11.3 曾因 `#555`+透明度後綴變無效色，YouTube 圖例變黑塊）。
3. 「開播至今播放排行榜 TOP 10」圖表存在且有 10 筆。
4. 單集總表欄數正確、「收聽平均比較」欄有紅升/綠降/—三態。
5. 「開播至今單集平均」與用另一條路徑重算的值一致（交叉驗證）。
6. 匯出獨立 HTML 後重新開啟，以上檢查全部再跑一次（畫面版對了不代表匯出版對，內嵌副本是獨立程式碼）。

## 假資料（fixtures）

make-fixtures.js 產生的資料是虛構的，刻意涵蓋這些真實會遇到的情況：
- YouTube 標題與 Podcast 標題不同（觸發可疑配對審查）
- 某些集數缺某平台（孤兒、以及「收聽平均比較」該顯示 — 的情況）
- YouTube Shorts（時長 < 180 秒，該被排除）
- YouTube CSV 的「總計」列（該被跳過）

**絕對不要**把真實節目數據放進 repo——.gitignore 已擋 *.csv/*.xlsx，不要繞過它。

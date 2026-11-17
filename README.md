# 節目組工具箱

鏡好聽（Mirror Voice）節目組的工具入口頁。此專案內建兩款收聽分析工具，皆在瀏覽器本機處理資料；另外連結至各自維護的外部工具。

## 工具

### 收聽數據分析與後製工具

- **RSS節目收聽分析**（`tool-1/`）：分析節目在 Apple Podcast、Spotify、YouTube 的收聽表現；YouTube 若有影音版，可額外上傳第 4 個來源分開統計。
- **鏡好聽平台收聽分析**（`tool-2/`）：分析鏡好聽 App 每週收聽 log。
- **EditCue**（外部網站）：逐字稿與初剪核對、後製需求標註及剪輯包匯出。
- **Playmark｜審聽神器**（正式版，Chrome 擴充功能）：播放 Google 雲端硬碟的音檔、影片並記錄附時間碼的審聽筆記，也可搭配 YouTube 影片作學習筆記。
- **Apple Podcasts 封面轉換器**（Gemini 外部連結）：協助節目封面的轉換處理。連結：https://gemini.google.com/share/c101facb2d8f

### 其他工具

- **Podcast 報獎雷達**（Beta，外部網站）：追蹤已查證的 Podcast 獎項資訊、徵件日曆與截止日期。

## 使用方式

開啟 `index.html`（或部署後的網址）即可選擇工具。Playmark 需從 Chrome 線上應用程式商店安裝，其餘工具由連結開啟。

工具箱首頁與兩款內建分析頁面統一署名：工具企劃與維護｜Ryuushouin Touga。聯絡方式為 `fywgogowild@gmail.com`，在網站頁尾使用 `mailto:` 連結；不放個人網站。

## 給維護者 / AI

修改前請先讀 `CLAUDE.md`（＝`維護指南.md`），裡面有所有規則、已知地雷與版本演進。

## 注意

本 repo 只放兩款收聽分析工具的程式碼及其他工具的入口連結。**任何節目收聽的 CSV／xlsx／log 資料檔都不應上傳到此處。** 外部工具的資料處理方式請參考各自說明。

---
Tool-1 v16 · Tool-2 v11.5 · 2026.07.20（完整紀錄見 CHANGELOG.md）

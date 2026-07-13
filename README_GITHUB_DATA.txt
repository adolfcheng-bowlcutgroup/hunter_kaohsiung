GitHub Pages data 自動讀取使用說明

1. 建議資料夾結構：

csv_integrator_model/
  index.html
  styles.css
  app.js
  data/
    manifest.json
    2026-07-01.csv
    2026-07-02.csv
    2026-07-03.csv

2. 每天更新資料時：

- 把新的每日報表 CSV 放進 data 資料夾。
- 編輯 data/manifest.json，把新檔案加入 files 清單。
- commit / push 到 GitHub。
- 同事開啟 GitHub Pages 網址後，index.html 會自動讀取 data/manifest.json 和 files 清單內的 CSV。

3. manifest.json 格式：

{
  "year": 2026,
  "files": [
    { "date": "2026-07-01", "path": "2026-07-01.csv" },
    { "date": "2026-07-02", "path": "2026-07-02.csv" }
  ]
}

4. 注意事項：

- path 是相對於 data 資料夾的檔名。
- date 建議手動填 YYYY-MM-DD，最穩定。
- 若沒有填 date，系統會嘗試從檔名抓 MMDD，但不建議依賴這個行為。
- 直接在本機用 file:// 開啟 index.html 時，部分瀏覽器會阻擋 fetch 讀取 data。部署到 GitHub Pages 後可正常使用。
- 手動上傳 CSV 功能仍保留，適合臨時測試或補檔。

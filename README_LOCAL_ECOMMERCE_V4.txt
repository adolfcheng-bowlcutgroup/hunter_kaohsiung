V4 更新紀錄

1. 資料來源視窗已移除手動補傳 CSV 功能面板。
   - 現場銷售資料固定從 data/manifest.json 與 data/*.csv 自動讀取。
   - 管理人只需要在 GitHub 的 data 資料夾更新資料檔與 manifest。

2. 單一商品趨勢分析視窗已移除「讀取電商報表」與「手動載入電商 CSV」按鈕。
   - 電商資料固定從 data/ecommerce_sales.csv 自動讀取。

3. 右下角懸浮切換按鈕名稱改為：
   - 只看現場
   - 現場+電商

建議本機測試方式：
cd hunter_kaohsiung-main
python -m http.server 8000
然後開啟 http://localhost:8000

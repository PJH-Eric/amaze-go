# 箭頭解密（Amaze GO）

點箭頭讓它沿尖端方向飛出棋盤；被別的箭頭擋住就撞回並扣愛心。可愛粉彩風，手機／平板／桌機皆可玩。

## 啟動
- `npm start`（或雙擊 `啟動遊戲.bat`）→ http://localhost:3080
- `npm test`：規則單元測試（種子可重現、四難度各 10 關保證有解、扣血／勝負／提示）

## 目前完成（M0 單機垂直切片）
四段難度（幼幼班／簡單／普通／困難）× 各 100 關，棋盤為 46 種實物/幾何輪廓（動物、交通工具、蔬果、生活、幾何，非方形）、隨關卡變大、提示、愛心、結算 overlay（再來一局／回到房間／回到首頁）、右上角設定 Modal（背景音樂、音效、減少動態、恢復預設）。
**尚未完成：線上同盤競速、AI、觀戰、邀請連結**（規則核心 `public/js/rules.js` 已與 DOM 分離，可直接給伺服器共用）。

## 部署（預設拓撲）
GitHub Pages 發布 `public/`，建置時以 repo variable `GAME_SERVER_URL` 取代 `public/js/config.js` 的佔位字串；線上版的 Render 服務請在 `render.yaml` 指定 `region: singapore`。

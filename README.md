# LINE × Tesla 家庭車機中心

一個專門給 Tesla 內建瀏覽器使用的「家庭提醒顯示器」。家人在 LINE 輸入，Tesla 只負責大字顯示；不使用 Tesla API、不讀 CAN、不控制車輛，也不會碰速度、排檔、煞車、Autopilot 或車門。

> 設計原則：**行駛中只看不操作；複雜輸入留在 LINE；需要勾選完成時，請停車後進入 `/manage.html`。**

## 1. 功能

- LINE 群組或 1 對 1 對 Bot 傳送：`車車 回家幫我買牛奶`
- 重要提醒：`車車！17:30 記得接小孩`
- 也接受：`提醒 ...`、`重要 ...`、`到家前 ...`
- Bot 回覆「已送到家庭車機」
- Tesla 首頁每 4 秒同步一次 D1，只顯示尚未完成的提醒
- 重要提醒自動排最上面
- `/`：行車顯示模式，完全沒有「完成／刪除／編輯」按鈕
- `/manage.html`：停車後操作，可按「完成」
- LINE Webhook 驗證 `x-line-signature`
- Tesla 第一次以 `?key=...` 設定顯示金鑰，之後存於該瀏覽器 LocalStorage 並自動把 key 從網址列移除

---

# 2. 架構

```text
家人 LINE
   ↓
LINE Messaging API Webhook
   ↓
Cloudflare Worker
   ↓
Cloudflare D1
   ↓
Tesla 內建瀏覽器 / 家庭中心
```

前端與 API 放在同一個 Cloudflare Worker。2026 年 Cloudflare 對新專案建議使用 **Workers Static Assets**；Pages 仍可使用，但新的能力與最佳化主要集中在 Workers。

---

# 3. 先準備 LINE Messaging API

## 3.1 建立 LINE Official Account

1. 進入 LINE Official Account Manager。
2. 建立一個帳號，例如：`家庭車機助手`。
3. 在 Official Account Manager 啟用 **Messaging API**。
4. 進入 LINE Developers Console。
5. 找到剛建立的 Messaging API channel。

你需要取得兩個值：

- **Channel secret** → 稍後存成 `LINE_CHANNEL_SECRET`
- **Channel access token** → 建議建立 long-lived token，稍後存成 `LINE_CHANNEL_ACCESS_TOKEN`

不要把這兩個值直接寫進 GitHub。

## 3.2 允許 Bot 加入群組

在 Messaging API / LINE Official Account 的設定中確認允許加入群組。把這個官方帳號邀請進你與家人的 LINE 群組。

LINE 官方支援 Bot 在群組接收訊息事件，也可以在群組回覆／主動傳送訊息。

---

# 4. 上傳專案到 GitHub

建立一個私人 GitHub Repository，例如：

`tesla-family-center`

把本資料夾內所有檔案上傳：

```text
public/
src/
schema.sql
wrangler.jsonc
package.json
README.md
.gitignore
```

> `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`DASHBOARD_KEY` 不要放進 GitHub。

---

# 5. Cloudflare 建立 D1

1. 登入 Cloudflare Dashboard。
2. 左側進入 **Storage & databases → D1 SQL database**（名稱可能依介面更新略有差異）。
3. 選擇 **Create database**。
4. Database name 輸入：

```text
tesla-family-center-db
```

5. 建立完成後記下 **Database ID**。
6. 打開資料庫的 Console / Query 頁面。
7. 把專案內 `schema.sql` 全部貼入並執行。
8. 確認至少看到：

```text
tasks
settings
```

兩張資料表。

---

# 6. 修改 wrangler.jsonc

打開：

`wrangler.jsonc`

找到：

```json
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

改成剛才 Cloudflare D1 顯示的 Database ID，然後 commit / push 到 GitHub。

Binding 名稱務必保持：

```text
DB
```

因為 Worker 程式使用 `env.DB`。

---

# 7. Cloudflare 從 GitHub 建立 Worker

2026 年新專案建議直接使用 Workers + Static Assets。

1. Cloudflare Dashboard → **Workers & Pages**。
2. 選擇 **Create application** / **Create Worker**。
3. 選擇從 Git Repository / GitHub 匯入專案。
4. 選擇你的 `tesla-family-center` Repository。
5. Build command 可使用：

```text
npm install
```

6. Deploy command：

```text
npx wrangler deploy
```

7. 儲存並部署。

`wrangler.jsonc` 已設定：

- Worker 程式：`src/worker.js`
- Static Assets：`./public`
- D1 binding：`DB`

部署成功後會得到類似：

```text
https://tesla-family-center.<你的帳號>.workers.dev
```

---

# 8. 設定 Worker Secrets

Cloudflare Dashboard：

**Workers & Pages → tesla-family-center → Settings → Variables and Secrets**

新增以下三個 **Secret**：

## LINE_CHANNEL_SECRET

填入 LINE Developers 的 Channel secret。

## LINE_CHANNEL_ACCESS_TOKEN

填入 Messaging API Channel access token。

## DASHBOARD_KEY

這是 Tesla 顯示端的私人金鑰，請自己產生一組很難猜的亂碼，例如至少 32 字元。

範例格式（不要照抄）：

```text
MyFamily-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

請選 Secret / Encrypt，而不是公開文字變數。

設定後重新部署一次 Worker，確保新 Secrets 生效。

---

# 9. 確認 D1 Binding

Worker → **Settings → Bindings**。

確認存在：

```text
Type: D1 database
Variable name: DB
Database: tesla-family-center-db
```

如果透過 `wrangler.jsonc` 部署已正確綁定，這裡應該會看到它。

---

# 10. LINE Webhook URL

假設 Worker 網址是：

```text
https://tesla-family-center.example.workers.dev
```

Webhook URL 就填：

```text
https://tesla-family-center.example.workers.dev/webhook
```

LINE Developers Console → Messaging API channel → Webhook settings：

1. 填入 URL。
2. 按 **Verify**。
3. 開啟 **Use webhook**。

Worker 會驗證 LINE 的 `x-line-signature`，Channel secret 不一致時會回傳 401。

---

# 11. 第一次在 Tesla 設定

停車狀態下，在 Tesla 內建 Browser 輸入：

```text
https://你的網址/?key=你的DASHBOARD_KEY
```

例如：

```text
https://tesla-family-center.example.workers.dev/?key=MyFamily-xxxxxxxxxxxx
```

第一次成功開啟後：

1. 網頁把 key 存在 Tesla Browser 的 `localStorage`。
2. 網址會自動變回：

```text
https://tesla-family-center.example.workers.dev/
```

所以 key 不會長期留在網址列。

之後直接開首頁即可。

> 若清除了 Tesla Browser 網站資料，就需要再用 `?key=` 設定一次。

---

# 12. 家人怎麼用 LINE

在已加入 Bot 的群組輸入：

## 一般提醒

```text
車車 回家幫我買牛奶
```

Tesla 會看到：

```text
家庭提醒 · 耀心
回家幫我買牛奶
```

## 重要提醒

```text
車車！17:30 記得接小孩
```

或：

```text
重要 17:30 記得接小孩
```

它會排在 Tesla 最上方，並使用更醒目的卡片。

## 其他可用寫法

```text
提醒 下班領包裹
到家前 買尿布
```

Bot 收到後會在 LINE 回覆：

```text
🚗 已送到家庭車機
回家幫我買牛奶
```

一般聊天不會進 Tesla。例如：

```text
晚餐吃什麼？
```

沒有指定指令，因此 Worker 會忽略。

---

# 13. Tesla 畫面分兩種

## `/` 行車顯示模式

```text
我們家                         17:26

❗重要 · 媽媽                 剛剛
17:30 記得接小孩

家庭提醒 · 媽媽               8 分鐘前
回家幫我買牛奶

行車顯示模式 · 僅供查看 · 請勿於行駛中操作螢幕
```

**沒有：**

- 完成按鈕
- 刪除按鈕
- 鍵盤
- 新增欄位
- 設定選單
- LINE 回覆框

這是刻意的安全設計。

## `/manage.html` 停車操作

停妥後才開：

```text
https://你的網址/manage.html
```

每個提醒旁只有一顆大按鈕：

```text
[ 完成 ]
```

按下後從未完成清單消失。

> 第一版故意不做「行駛狀態自動判斷」，因為一般網頁不應假裝自己能可靠讀取 Tesla 的 P/D/R/N。安全性採用頁面本身的用途分離，而不是宣稱能讀 Tesla 排檔。

---

# 14. 同步速度

Tesla 首頁每 **4 秒**呼叫一次：

```text
GET /api/tasks
```

因此不依賴 Web Push 或 Tesla 系統通知。

只要：

- Tesla Browser 頁面仍在
- Browser 有網路
- JavaScript 沒被瀏覽器暫停

LINE 新提醒就會在下一輪同步出現。

若網路中斷，畫面會顯示：

```text
目前離線，恢復網路後會自動同步
```

---

# 15. API

## 健康檢查

```text
GET /api/health
```

不需要金鑰。

## 取得待辦

```text
GET /api/tasks
Authorization: Bearer <DASHBOARD_KEY>
```

## 完成

```text
POST /api/tasks/:id/complete
Authorization: Bearer <DASHBOARD_KEY>
```

---

# 16. 安全設計

1. **完全沒有 Tesla API Token。**
2. **完全沒有 Tesla Login。**
3. **不讀 CAN。**
4. **不控制排檔、速度、方向盤、煞車、Autopilot、車門。**
5. LINE Webhook 驗證 HMAC-SHA256 簽章。
6. Dashboard API 需要 `DASHBOARD_KEY`。
7. GitHub 裡不保存任何 LINE Token / Secret。
8. 前端輸出文字做 HTML escape，避免家人輸入內容變成 HTML。
9. 行車首頁不提供互動按鈕。

注意：`DASHBOARD_KEY` 會存在 Tesla Browser 的 LocalStorage；因此不要與銀行、電子郵件或其他帳號密碼共用。若懷疑外洩，直接在 Cloudflare 更換 Secret，然後在 Tesla 重新以 `?key=` 設定。

---

# 17. 測試順序

建議按照以下順序：

1. 開啟 `/api/health`，應看到 `{"ok":true,...}`。
2. 在 Tesla / 電腦以 `/?key=你的DASHBOARD_KEY` 開首頁。
3. LINE 群組傳：

```text
車車 測試家庭提醒
```

4. LINE Bot 應回覆「已送到家庭車機」。
5. 最慢下一次 4 秒同步應在網頁看到訊息。
6. 再傳：

```text
車車！這是重要提醒
```

7. 重要提醒應排在第一張。
8. 停車後開 `/manage.html`，按完成。
9. 回 `/`，該筆應消失。

---

# 18. 常見問題

## LINE Verify Webhook 失敗

確認：

- URL 是 `/webhook`
- HTTPS 正常
- `LINE_CHANNEL_SECRET` 沒貼錯
- Worker 已重新部署

## LINE Bot 有回覆，但 Tesla 沒看到

檢查：

- D1 Binding 名稱是否為 `DB`
- `schema.sql` 是否已執行
- Tesla 是否已設定正確 `DASHBOARD_KEY`
- `/api/tasks` 是否回 401

## Tesla 顯示「第一次設定」

再次停車後開：

```text
https://你的網址/?key=你的DASHBOARD_KEY
```

## 一般 LINE 聊天為什麼沒有出現？

這是故意的。只有以下開頭才進車機：

```text
車車 
車車！
提醒 
重要 
到家前 
```

避免家庭群組每句聊天都跑到 Tesla。

---

# 19. 本機開發（可選，不是部署必要條件）

如果你想在 Mac 測試：

```bash
npm install
npm run db:local
npm run dev
```

建立 `.dev.vars`：

```text
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
DASHBOARD_KEY=...
```

`.dev.vars` 已被 `.gitignore` 排除。

---

# 20. 後續可以加什麼

第一版先維持「簡單、安全、每天真的會用」。後續再考慮：

- LINE 指令直接標記完成
- 指定時間提醒
- 「到家前」專區
- 今日接送行程
- 家庭成員自訂名稱
- WebSocket / Durable Objects 即時更新，取代 4 秒 polling
- PWA 手機管理介面
- LINE Flex Message 顯示「已完成」狀態
- 完成後 LINE 回報給原群組

刻意不加入：Tesla API 控車、CAN、排檔偵測、行駛中複雜操作。

---

## 官方文件參考

- Cloudflare Workers Static Assets
- Cloudflare Workers D1 / Bindings
- LINE Messaging API：Receiving messages / Webhook
- LINE Messaging API：Group chats
- LINE Developers：Webhook signature verification

README 內容依 2026-08 的 Cloudflare / LINE 官方文件方向整理；Cloudflare Dashboard 選單名稱可能隨介面更新略有差異。

---

## 本機直接雙擊預覽（v1.0.1 修正）

你可以直接雙擊 `public/index.html` 預覽 Tesla 中控介面。

- 使用 `file://` 開啟時，系統會自動進入「本機預覽模式」。
- CSS / JavaScript 使用相對路徑，所以不會再出現只有黑字白底、樣式完全消失的情況。
- 本機預覽會顯示兩筆範例家庭提醒，方便先確認 Tesla 大字介面。
- 本機預覽 **不會真的連接 LINE / D1**，因為 `/api/tasks` 是 Cloudflare Worker API，必須使用 `npm run dev` 或部署到 Cloudflare 才存在。

若要在 Mac 本機連同 Worker / D1 一起測試，請依前面章節完成設定後執行：

```bash
npm install
npm run dev
```

再開啟 Wrangler 顯示的本機網址（通常是 `http://localhost:8787`），即可測試真正 API 流程。

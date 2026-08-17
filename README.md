# LINE × Tesla 家庭車機中心 v2

這是一個以 **LINE 當輸入端、Tesla Browser 當大字顯示端** 的家庭提醒系統。

設計原則不變：**行駛中只看、不操作；複雜輸入全部留在 LINE；需要按完成時請停車後使用 `/manage.html` 或直接在 LINE 輸入完成指令。**

系統不使用 Tesla API、不讀 CAN、不控制速度、排檔、煞車、方向盤、Autopilot 或車門。

---

## v2 新功能

- LINE 指令直接完成提醒
- 指定時間提醒
- 「到家前」獨立專區
- 「今日接送」獨立專區
- 家庭成員自訂名稱
- Durable Objects + WebSocket 即時更新，取代原本每 4 秒 polling
- PWA 手機停車管理介面
- LINE Flex Message 顯示新增與完成狀態
- 完成後主動回報原本的 LINE 私聊／群組
- 每分鐘 Cron 檢查到期提醒並主動推播 LINE

---

# 1. v1 已部署使用者：先做 D1 升級

如果你原本 v1 已經成功使用，**不要重新執行 `schema.sql`**。

進入 Cloudflare：

`Storage & databases → D1 → tesla-family-center-db → Console`

把 GitHub 根目錄的：

`migration-v2.sql`

完整貼入並執行 **一次**。

成功後 `tasks` 會新增：

- `due_at`
- `category`
- `notified_at`
- `completed_by`

並新增：

`members`

資料表。

> `migration-v2.sql` 只能對同一個資料庫跑一次；重複跑會因欄位已存在而報錯。

如果是全新安裝，直接執行最新版 `schema.sql` 即可，不需要跑 migration。

---

# 2. Cloudflare 自動部署

GitHub 已經更新為 v2。若 Worker 已連接 GitHub main branch，通常會自動觸發 Build。

Build command：

`npm install`

Deploy command：

`npx wrangler deploy`

最新版 `wrangler.jsonc` 已包含：

- D1 binding：`DB`
- Durable Object binding：`REALTIME`
- Durable Object class：`RealtimeHub`
- migration：`v2-realtime`
- Cron：`* * * * *`，每分鐘檢查到期提醒
- Static Assets：`./public`

Cloudflare 官方建議 Durable Objects 的 WebSocket 使用 Hibernation API；本專案使用 `acceptWebSocket()`，閒置時可以讓 Durable Object hibernate，降低長連線的 duration 成本。

第一次把 Durable Object migration 部署上去時，Build 會建立 `RealtimeHub` 類別。不要手動刪除 `migrations` 設定。

---

# 3. Secrets 不需要新增

仍然只需要原本三個：

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `DASHBOARD_KEY`

建議三個都設定成 Cloudflare **Secret** 類型，不要放 GitHub。

---

# 4. LINE 指令

## 一般提醒

`車車 回家幫我買牛奶`

## 重要提醒

`車車！記得帶證件`

或：

`重要 記得帶證件`

## 指定時間提醒

目前支援台灣時間：

`提醒 18:30 領包裹`

`提醒 明天 08:10 帶小孩上學`

`提醒 8/20 17:30 接小孩`

有時間的提醒會顯示在 Tesla，並由 Cloudflare Cron 每分鐘檢查；時間到後 LINE Bot 會主動送出 Flex Message。

因此提醒可能在指定分鐘內出現，不設計成秒級鬧鐘。

## 今日接送

`接送 17:30 接妹妹下課`

也可以：

`接送 明天 07:40 送哥哥上學`

Tesla 首頁會把這類事項放在最前面的：

`🚸 今日接送`

專區。

## 到家前

`到家前 買尿布`

`到家前 領包裹`

會集中顯示在：

`🏠 到家前`

專區。

## 自訂家庭名稱

每個家庭成員第一次可傳：

`我是 媽媽`

`我是 爸爸`

`我是 耀心`

Bot 會把 LINE user ID 與家庭名稱存進 D1。

之後 Tesla 顯示的建立者會優先使用這個自訂名稱，而不是 LINE profile 名稱。

## 在 LINE 完成提醒

建立提醒後 Flex Message 會顯示 ID，例如：

`#12`

可以直接傳：

`完成 12`

也支援用訊息關鍵字：

`完成 牛奶`

如果有多筆同名提醒，系統會完成最新一筆符合的未完成事項；因此建議使用 ID 最準確。

完成後：

1. D1 狀態改成 done。
2. Tesla / PWA 透過 WebSocket 即時移除。
3. LINE 會收到 `✅ 已完成` Flex Message。
4. 如果提醒原本是群組建立，系統會主動回報到原群組。

---

# 5. LINE Flex Message

建立提醒時 Bot 不再只有純文字，而會回覆卡片：

- 已送到家庭車機
- 類型：家庭提醒／重要／接送／到家前
- 內容
- Task ID
- 指定時間（有的話）

完成時則會顯示：

`✅ 已完成`

以及完成者。

LINE 官方支援在一對一、群組與多人聊天室使用 reply message；主動回報則使用 push message，群組時 `to` 使用 webhook 收到的 groupId。

---

# 6. Tesla 首頁

Tesla 繼續開原本網址：

`https://你的網址/`

第一次仍然：

`https://你的網址/?key=你的DASHBOARD_KEY`

頁面現在分成：

1. `🚸 今日接送`
2. `🏠 到家前`
3. `🔔 家庭提醒`

行車首頁仍然沒有完成、刪除、輸入或編輯按鈕。

右上角會看到 WebSocket 狀態：

`即時連線`

LINE 新增提醒後，Worker 寫入 D1，接著 Durable Object broadcast；Tesla 收到 WebSocket 訊息後立即重新讀取 D1。

不再固定每 4 秒輪詢。

如果 WebSocket 因網路切換斷線，前端會自動重連，回到頁面前景時也會重新同步一次。

---

# 7. PWA 手機管理介面

手機開：

`https://你的網址/manage.html`

第一次若這台手機沒有 key：

`https://你的網址/manage.html?key=你的DASHBOARD_KEY`

iPhone Safari 可選：

`分享 → 加入主畫面`

之後會以接近 App 的 standalone 模式開啟。

這個頁面可以：

- 看全部未完成事項
- 看提醒類型
- 看指定時間
- 看家庭成員名稱
- 按大顆 `✓ 完成`

當手機按完成時，也會透過原本的 LINE source ID 回報原群組／原對話。

> Tesla 行車首頁 `/` 沒有操作按鈕；`/manage.html` 明確定位為停車或手機操作頁。

---

# 8. WebSocket / Durable Objects

前端連線：

`wss://你的網域/ws?key=DASHBOARD_KEY`

Worker 先驗證 Dashboard Key，再轉交唯一的 `RealtimeHub` Durable Object。

當以下事件發生：

- LINE 新增提醒
- LINE 完成提醒
- Tesla/PWA 完成提醒
- 家庭名稱更新
- 指定時間到期

Worker 都會 broadcast 一個 `refresh` 事件。

所有正在開著的 Tesla / 手機管理頁會立即重新抓取 `/api/tasks`。

這保留 D1 為資料來源，WebSocket 只負責「通知畫面有變更」，架構比直接把完整資料塞在 WebSocket 中更單純。

---

# 9. 指定時間提醒運作方式

`wrangler.jsonc`：

```json
"triggers": {
  "crons": ["* * * * *"]
}
```

Worker `scheduled()` 每分鐘查詢：

- `status = open`
- `due_at <= 現在`
- `notified_at IS NULL`

符合後推播 LINE，再寫入 `notified_at`，避免同一筆每分鐘重複提醒。

目前解析以台灣時區 `Asia/Taipei` 為準。

---

# 10. 健康檢查

打開：

`https://你的網址/api/health`

正常會類似：

```json
{
  "ok": true,
  "version": "2.0.0",
  "time": 1786950000000,
  "realtime": true,
  "db": true
}
```

`realtime: true` 代表 Durable Object binding 已成功載入。

---

# 11. v2 建議測試順序

升級 D1 並完成 Cloudflare Deploy 後：

1. 開 `/api/health`，確認 `version` 是 `2.0.0`、`realtime` 是 true。
2. LINE 傳：`我是 媽媽`。
3. LINE 傳：`車車 買牛奶`。
4. Tesla / 電腦首頁應幾乎立即出現「買牛奶」。
5. LINE 傳：`到家前 買尿布`，確認出現在到家前專區。
6. LINE 傳：`接送 17:30 接小孩`，確認出現在接送專區。
7. LINE 找剛建立的 ID，傳：`完成 12`。
8. 確認 Tesla 即時移除。
9. 確認 LINE 收到完成 Flex Message。
10. 在 `/manage.html` 新增另一筆後按完成，確認原 LINE 對話／群組收到完成回報。
11. 測試 `提醒` 指定一個接下來 2～3 分鐘的時間，確認時間到 LINE 收到主動提醒。

---

# 12. 安全注意

- 不把 LINE Token / Secret 放進 GitHub。
- LINE Webhook 繼續驗證 `x-line-signature`。
- Dashboard API 與 WebSocket 都需要 `DASHBOARD_KEY`。
- WebSocket key 因瀏覽器 API 無法自訂 Authorization header，所以使用 query string；第一次頁面 URL 的 key 仍會存 LocalStorage 並從地址列清除。
- 建議 Dashboard Key 使用至少 32 字元隨機值。
- LINE Channel Secret、Access Token 若曾出現在公開截圖，請重新產生或 rotate。
- PWA Service Worker 不會快取 `/api/*`、`/webhook` 或 `/ws`。
- 行駛時不要操作 `/manage.html`。

---

## v2 檔案

```text
src/worker.js
public/index.html
public/app.js
public/manage.html
public/manage.js
public/style.css
public/manifest.webmanifest
public/sw.js
schema.sql
migration-v2.sql
wrangler.jsonc
package.json
README.md
```

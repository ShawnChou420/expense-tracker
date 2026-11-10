# 部署後端到 Render

> 對應設定檔：專案根目錄的 `render.yaml`、`backend/Dockerfile`、`.dockerignore`。
> 本文件不含、也不要加入任何密碼、token 或資料庫連線字串。

## 架構

```
Android App（Capacitor，origin = https://localhost）
   │ HTTPS + Bearer token
   ▼
Render Web Service「expense-tracker-api」（新加坡，Docker，Java 21）
   │ Render 內部網路（DATABASE_URL，自動注入）
   ▼
Render Postgres「expense-tracker-db」（新加坡，PostgreSQL 17，不開放外部 IP）
```

- 啟動時 Flyway 自動在**空資料庫**建立 V1–V6，不需要也不可以執行 `baselineExisting`。
- `DATABASE_URL` 由 Render 注入，程式在啟動時轉成 JDBC 設定（`DatabaseUrl.java`）。本機仍用 `DB_URL`／`DB_USER`，有設定 `DB_URL` 時一律以它為準。
- 健康檢查：`GET /api/health` 回傳 `{"status":"ok"}`，不需登入、不含任何資料。

## 方案與費用

| 項目 | `render.yaml` 中的方案 | 說明 |
| --- | --- | --- |
| Web Service | `0.5c-512mb`（0.5 CPU / 512 MB） | 付費最小方案，不會閒置休眠。免費方案閒置 15 分鐘就休眠、喚醒約 1 分鐘。 |
| Postgres | `0.1c-256mb`（0.1 CPU / 256 MB） | 付費最小方案，含時間點還原（PITR）。免費資料庫 30 天後到期、沒有任何備份。 |

實際月費以建立 Blueprint 時 Render 顯示的金額為準；資料庫另依儲存空間計費。

## 第一次部署（需要你本人操作的步驟）

1. **合併到 `main`**：`render.yaml` 指定從 `main` 部署。把 `deploy-backend` 分支推上 GitHub、開 PR、確認後合併。
2. **建立 Render 帳號**並連結 GitHub（帳號與付款資料請自己在 Render 網站輸入）。
3. Render Dashboard → **New → Blueprint** → 選 `ShawnChou420/expense-tracker` 儲存庫。Render 會讀取 `render.yaml`，列出一個 Web Service 和一個資料庫。
4. 畫面會要求輸入 `CORS_ORIGINS`：
   - 只有 Android App：`https://localhost`
   - 之後若部署 Web 版前端，用逗號加上它的 HTTPS 網址，例如 `https://localhost,https://your-web.onrender.com`
5. 確認費用後按 **Apply**。第一次建置約 5–10 分鐘（要下載 Gradle 與相依套件）。
6. 部署完成後，在服務頁面上方找到網址（通常是 `https://expense-tracker-api.onrender.com`，名稱被佔用時會加後綴），用瀏覽器打開：
   - `https://<你的網址>/api/health` → 應看到 `{"status":"ok"}`
   - 在 Logs 頁面確認有 Flyway 套用 V1–V6 的紀錄，且沒有錯誤。

## 讓 Android App 連到正式 API

1. 在專案根目錄建立 `.env.production.local`（已被 `.gitignore` 排除，不會進 Git）：
   ```
   VITE_API_BASE_URL=https://<你的網址>/api
   ```
2. 重新建置並同步到 Android：`npm run android:sync`，再用 `npm run android:open` 安裝到手機測試註冊、登入、新增班表。
3. **Web build 成功不代表手機已更新**，一定要實機確認。

> `VITE_*` 變數會被打包進 App，任何人都能從 APK 取出。只能放 API 網址這類公開資訊，絕對不要放 API key、密碼或 token。

## 備份與還原

- **時間點還原（PITR）**：付費資料庫會持續備份，可還原到過去幾天內的任一時間點（Hobby 方案 3 天、Pro 以上 7 天）。在資料庫頁面的 **Recovery** 操作，會建立一個新的資料庫實例。
- **手動匯出（Logical backup）**：在資料庫頁面建立並下載，Render 保留 7 天。建議每月下載一份存到自己的電腦或雲端硬碟，長期保存。

### 還原演練（建議上線後一週內做一次）

1. 在 Render 建立一份 logical backup 並下載。
2. 在本機建立一個**全新、專門用來演練的**資料庫（不要用平常開發的 `expense_tracker`），用 `pg_restore` 匯入。
3. 比對幾張主要資料表的筆數（`user_info`、`work_shift_info`、`expense_record`）是否和正式環境一致。
4. 演練完刪除該演練資料庫與下載檔。

## 日常更新與回滾

- 合併到 `main` 且有修改 `backend/**`、`render.yaml` 或 Gradle wrapper 時會自動部署；只改前端不會觸發。
- 新版本健康檢查沒通過時，Render 不會切換流量，舊版本繼續服務。
- 需要回滾時，在服務的 **Events** 頁面選擇先前成功的部署 → Rollback。
- **資料庫 migration 只能往前**：回滾程式不會回滾資料表。新增 migration 時要確保舊版程式仍能運作（例如先加欄位、之後再移除舊欄位）。

## 需要從本機連到正式資料庫時

`render.yaml` 設定 `ipAllowList: []`，資料庫只接受 Render 內部連線。若必須從本機用 `psql` 或 `pg_dump` 連線：

1. 在資料庫頁面的 Networking 暫時加入自己目前的 IP。
2. 使用 Dashboard 提供的 External URL 連線，完成後**立即移除該 IP**。
3. 不要把連線字串貼到文件、commit、聊天或截圖裡。

## 本機驗證容器（選用）

```sh
docker build -f backend/Dockerfile -t expense-tracker-api .
```

建置 context 必須是專案根目錄，因為 `backend/gradlew` 會呼叫 `android/gradlew`。

## 尚未完成（上線後仍需處理）

- Email 驗證、忘記密碼、刪除帳號（Google Play 上架要求）。
- 登入失敗次數仍存在伺服器記憶體，每次重新部署會歸零。
- 前端 token 只放記憶體，重開 App 要重新登入。
- 沒有監控與告警（可先使用 Render 的 Notifications 設定部署失敗通知）。
- `server.forward-headers-strategy: native` 在 Render 代理後面能否取得正確的使用者 IP，**尚未在正式環境驗證**。
- 過期的 `auth_session` 紀錄不會自動清除。

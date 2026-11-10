# 部署後端到 Render（資料庫使用 Neon）

> 對應設定檔：專案根目錄的 `render.yaml`、`backend/Dockerfile`、`.dockerignore`。
> 本文件不含、也不要加入任何密碼、token 或資料庫連線字串。

## 架構

```
網頁版（Render Static Site「expense-tracker-web」，免費）  Android App（Capacitor，origin = https://localhost）
   └──────────────────────────────┬──────────────────────────┘
   │ HTTPS + Bearer token
   ▼
Render Web Service「expense-tracker-api」（新加坡，Docker，Java 21，免費方案）
   │ 公開網路 + SSL（DATABASE_URL，由你在 Render 後台貼上）
   ▼
Neon Postgres（AWS ap-southeast-1 新加坡，PostgreSQL 17，免費方案）
```

- 啟動時 Flyway 自動在**空資料庫**建立 V1–V6，不需要也不可以執行 `baselineExisting`。
- `DATABASE_URL` 是 Neon 提供的 `postgresql://...` 連線字串，程式在啟動時轉成 JDBC 設定（`DatabaseUrl.java`），會保留 `sslmode=require` 等參數。本機仍用 `DB_URL`／`DB_USER`，有設定 `DB_URL` 時一律以它為準。
- 健康檢查：`GET /api/health` 回傳 `{"status":"ok"}`，不需登入、不含任何資料。

## 方案與費用

| 項目 | 方案 | 說明 |
| --- | --- | --- |
| Render Web Service | `free` | 閒置 15 分鐘休眠，之後第一次打開 App 要等它喚醒（約 1 分鐘，Java 在免費 CPU 上可能更久）。想要不休眠就把 `plan` 改成 `0.5c-512mb`（2026-11 顯示 US$7/月）。 |
| Neon Postgres | Free | 儲存空間約 0.5 GB（記帳資料足夠），閒置幾分鐘後自動暫停、下次連線自動喚醒。**可還原的時間範圍很短**，必須自己定期匯出備份（見下方）。 |

額度與限制以 Render、Neon 官網目前的方案頁為準。**不要使用 Render 的免費資料庫**：30 天後到期、沒有任何備份。

需要更完整的備份時，可以改用 Render 付費 Postgres（2026-11 顯示 `0.1c-256mb` 約 US$10.50/月，含時間點還原），再用 `pg_dump`／`pg_restore` 把資料從 Neon 搬過去。

## 第一次部署（需要你本人操作的步驟）

### 1. 建立 Neon 資料庫

1. 到 neon.tech 註冊並建立 Project：
   - Region 選 **AWS Asia Pacific (Singapore)**（和 Render 同區，延遲最低）
   - Postgres 版本選 17
2. 在 Project 的 **Connect** 視窗：
   - 資料庫可用預設的 `neondb`
   - **關閉 Connection pooling**，複製「直連」的連線字串（主機名稱不含 `-pooler`）。Flyway migration 需要直連。
3. 連線字串**只貼到 Render 後台**，不要貼到文件、commit、聊天或截圖裡。

### 2. 建立 Render 服務

1. Render Dashboard → **New → Blueprint** → 選 `ShawnChou420/expense-tracker`，Branch 用 `main`。
2. 畫面會要求輸入兩個環境變數：
   - `DATABASE_URL`：貼上 Neon 的連線字串
   - `CORS_ORIGINS`：只有 Android App 時填 `https://localhost`；之後若部署 Web 版前端，用逗號加上它的 HTTPS 網址
3. 確認費用為 $0 後按 **Deploy Blueprint**。第一次建置約 5–10 分鐘。
4. 部署完成後，在服務頁面上方找到網址，用瀏覽器打開：
   - `https://<你的網址>/api/health` → 應看到 `{"status":"ok"}`
   - 在 Logs 頁面確認有 Flyway 套用 V1–V6 的紀錄，且沒有錯誤。

## 網頁版前端（Render Static Site）

- `render.yaml` 的 `expense-tracker-web` 會在 Blueprint 同步時自動建立，執行 `npm ci && npm run build`，發布 `dist/`。免費、不會休眠。
- 後端網址寫在 `render.yaml` 的 `VITE_API_BASE_URL`（公開資訊）。後端網址變更時要一起改，並重新建置前端。
- **建立後要把網頁網址加進後端的 CORS**：Render → `expense-tracker-api` → Environment → `CORS_ORIGINS` 改成
  `https://localhost,https://<網頁版網址>`（逗號分隔，不要有結尾斜線），儲存後後端會重新部署。少了這步，瀏覽器會擋下網頁呼叫 API。
- 只改後端不會重新建置前端，只改前端也不會重新部署後端（`buildFilter`）。
- 網頁版登入 token 只放記憶體，重新整理頁面需要重新登入；訪客資料重新整理後會消失。

## 讓 Android App 連到正式 API

1. 在專案根目錄建立 `.env.production.local`（已被 `.gitignore` 排除，不會進 Git）：
   ```
   VITE_API_BASE_URL=https://<你的網址>/api
   ```
2. 重新建置並同步到 Android：`npm run android:sync`，再用 `npm run android:open` 安裝到手機測試註冊、登入、新增班表。
3. **Web build 成功不代表手機已更新**，一定要實機確認。
4. 後端休眠時，第一次登入會等比較久，這是免費方案的正常現象。

> `VITE_*` 變數會被打包進 App，任何人都能從 APK 取出。只能放 API 網址這類公開資訊，絕對不要放 API key、密碼或 token。

## 備份與還原

Neon 免費方案可還原的時間範圍很短，**請自己定期匯出**（建議每週一次，或有大量資料變動後）：

```sh
# 連線字串從 Neon 後台複製，只在自己的終端機使用，不要存進專案或 shell 歷史檔
pg_dump --format=custom --no-owner "$NEON_DATABASE_URL" -f expense-tracker-$(date +%F).dump
```

- 本機的 `pg_dump` 主版本要 ≥ 17。
- 備份檔含所有會員資料，存在自己的電腦或私人雲端硬碟，不要上傳到公開位置或 Git。

### 還原演練（建議上線後一週內做一次）

1. 在本機建立一個**全新、專門用來演練的**資料庫（不要用平常開發的 `expense_tracker`），用 `pg_restore --no-owner` 匯入備份檔。
2. 比對幾張主要資料表的筆數（`user_info`、`work_shift_info`、`expense_record`）是否和正式環境一致。
3. 演練完刪除該演練資料庫。

## 日常更新與回滾

- 合併到 `main` 且有修改 `backend/**`、`render.yaml` 或 Gradle wrapper 時會自動部署；只改前端不會觸發。
- 新版本健康檢查沒通過時，Render 不會切換流量，舊版本繼續服務。
- 需要回滾時，在服務的 **Events** 頁面選擇先前成功的部署 → Rollback。
- **資料庫 migration 只能往前**：回滾程式不會回滾資料表。新增 migration 時要確保舊版程式仍能運作（例如先加欄位、之後再移除舊欄位）。

## 本機驗證容器（選用）

```sh
docker build -f backend/Dockerfile -t expense-tracker-api .
```

建置 context 必須是專案根目錄，因為 `backend/gradlew` 會呼叫 `android/gradlew`。

## 尚未完成（上線後仍需處理）

- Email 驗證、忘記密碼、刪除帳號（Google Play 上架要求）。
- 登入失敗次數仍存在伺服器記憶體，每次重新部署或休眠後會歸零。
- 前端 token 只放記憶體，重開 App 要重新登入。
- 沒有監控與告警（可先使用 Render 的 Notifications 設定部署失敗通知）。
- `server.forward-headers-strategy: native` 在 Render 代理後面能否取得正確的使用者 IP，**尚未在正式環境驗證**。
- 過期的 `auth_session` 紀錄不會自動清除。
- Render 免費方案搭配 Neon 的實際啟動時間與連線，**尚未在正式環境驗證**。

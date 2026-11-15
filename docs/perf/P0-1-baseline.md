# P0-1：效能基準與瓶頸定位

狀態：量測工具已完成並在本機驗證；**正式環境數字尚未量測**（需擁有者操作，見第 4 節）。
日期：2026-11-16

## 1. 新增的量測工具

全部只記錄時間、次數與路由樣板，**不記錄 Email、token、SQL 內容、參數或回應內容**。

| 位置 | 內容 | 怎麼看 |
|---|---|---|
| 後端 `RequestTimingFilter` | 每個 `/api/*` 請求一行：方法、路由樣板、狀態碼、總耗時、SQL 時間與次數、取得連線的時間與次數、Hikari 連線池 active/idle/waiting/total、JVM 已執行秒數（`uptime`，判斷是否剛冷啟動）。`/api/health` 不記錄。 | Render → Logs 搜尋 `TIMING` |
| 後端 `TimedDataSource` | 包住連線池量測 SQL `execute*` 與 `getConnection` 耗時。只計時、不改變行為（不含讀取 ResultSet 的時間）。 | 包含在 TIMING 行內 |
| 後端 `PerformanceDiagnostics` | 啟動時記錄 Flyway 耗時、可接受請求的時間、容器看到的 CPU 數與最大 heap。 | Render → Logs 搜尋 `STARTUP` |
| 後端 `Server-Timing` 標頭 | `app;dur=…, db;dur=…;desc="N queries", conn;dur=…`。**預設關閉**，環境變數 `SERVER_TIMING_ENABLED=true` 才送出。 | 瀏覽器開發者工具 Network → Timing |
| 前端 `src/services/perfTrace.js` | 記錄每個 API 請求耗時（含伺服器端拆解）與兩個階段：「恢復登入」「登入後載入資料」，並列出重複呼叫的路徑。**預設關閉**。 | 網址加 `?perf=1`，Console 輸入 `__perf.summary()`；`?perf=0` 關閉 |
| `scripts/perf/measure-public.sh` | 用 curl 量測公開唯讀端點（`/health`、`/auth/config`）的 DNS、連線、TLS、TTFB、總時間。 | 終端機執行 |

> `Server-Timing` 會讓用戶端看到伺服器端的耗時拆解。現在登入已經有可觀察的時間差（Email 不存在時不跑 BCrypt，回應較快），打開標頭會讓這個差異更容易量。**只在量測期間暫時打開，量完就關閉**；時間差本身列入 P0-2 修正。

## 2. 本機實測（**不代表正式環境**）

環境：Apple M1（8 核）、本機 PostgreSQL 17（同一台機器、無網路延遲）、全新空資料庫、`SERVER_TIMING_ENABLED=true`。
正式環境是 Render Free（共享、低 CPU）＋ Neon Free（新加坡），CPU 與網路差異很大，以下只用來看**結構**（哪一段占比高、請求數多少），不能拿來推估正式環境的秒數。

### 2.1 啟動

| 項目 | 數值 |
|---|---|
| Flyway（全新資料庫，套用 V1–V8） | 388 ms |
| Spring Boot 可接受請求 | 1.5 s（JVM 1.7 s） |

### 2.2 單一請求（curl，各 1–3 次）

| 請求 | 總耗時 | SQL 時間 | SQL 次數 | 說明 |
|---|---|---|---|---|
| `POST /auth/register` | 120.8 ms | 7.0 ms | 5 | 本機 `MAIL_MODE=log`，不含真實 SMTP 寄信時間 |
| `POST /auth/login` ×3 | 95.2／93.2／97.0 ms | 1.2–1.6 ms | 3 | **約 98% 是 BCrypt**，不是資料庫 |
| `GET /work-records` | 10.6 ms | 6.7 ms | 3 | |
| `GET /expenses` | 4.3 ms | 2.6 ms | 3 | 空帳號；有固定支出時每筆多 1 次查詢（N+1） |
| `GET /dashboard-settings` | 4.0 ms | 2.3 ms | 5 | 同一張表分兩次查 |
| `GET /salary-rates` | 3.1 ms | 2.0 ms | 3 | |

每個登入後的請求固定多 **2 次 SQL**：`TokenFilter` 查 `auth_session`，再加上滑動期限的 `UPDATE`。UPDATE 雖然大多不會改到資料，但**每個請求都會送出一次**。而且每次 SQL 各自向連線池取一次連線（`checkouts` 等於 SQL 次數）。

### 2.3 登入後的請求瀑布（瀏覽器，`?perf=1`，空帳號恢復登入）

| 階段 | 耗時（本機） | 請求數 |
|---|---|---|
| 恢復登入（`/auth/me`） | 31 ms | 6（含訪客畫面同時發出的請求） |
| 登入後載入資料（`handleSignedIn`） | 119 ms | 27 |
| 開啟後 4 秒內合計 | — | **42** |

重複呼叫（4 秒內）：`/dashboard-settings` ×9、`/trips` ×7、`/expenses` ×7、`/passengers` ×4、`/salary-deposits` ×3，其餘 `/work-records`、`/leave-blackouts`、`/work-profile`、`/salary-rates` 各 ×2。
42 個請求 × 每個至少 3 次 SQL，約 **130 次以上的資料庫往返**。本機沒有網路延遲所以不明顯；正式環境每次往返都要經過 Render → Neon 的網路，而且 Render 只有 5 條連線、低 CPU。

## 3. 瓶頸假設（依本機結構推論，待正式環境數字確認）

| # | 假設 | 依據 | 能否用程式改善 |
|---|---|---|---|
| H1 | 閒置後第一次開啟要等很久，主因是 Render 休眠喚醒加上 JVM 冷啟動 | Render Free 平台特性；STARTUP log 可以確認實際秒數 | **不能消除**，只能改善等待體驗（P0-2：明示「伺服器啟動中」、可安全重試） |
| H2 | Neon 自動暫停後，第一條連線要先喚醒資料庫 | TIMING 行的 `conn=` 在冷啟動後第一個請求會明顯偏高 | 不能消除；可評估連線池設定（**需先有數字**） |
| H3 | 登入慢主要是 BCrypt，在低 CPU 上會被放大 | 本機 login 95 ms 中 SQL 只有 1.5 ms | 不降低 BCrypt 強度；可避免同一流程重複驗證 |
| H4 | 登入後「轉很久」主要是 42 個請求、多段依序等待，加上大量重複 | 2.3 節 | **可以**（P0-2：去重、合併、並行） |
| H5 | 每個請求固定多 2 次 SQL（token 查詢＋滑動期限 UPDATE） | 2.2 節 | **可以**（P0-2：UPDATE 只在需要延長時送出） |
| H6 | 註冊時同步寄歡迎信，SMTP 慢時註冊跟著卡住（timeout 各 10 秒） | `AuthController.register` | **可以**（P0-2：改成不阻塞回應） |

## 4. 正式環境量測步驟（需擁有者操作）

我沒有 Render、Neon 後台權限，也不會連線正式資料庫。以下由你操作，把數字填進第 5 節。

1. **合併這個 PR 之後**（會自動部署後端），在 Render 後台暫時加上環境變數 `SERVER_TIMING_ENABLED=true`（量完刪除）。這是量測用開關，不影響功能。
2. **冷啟動**：確認後端已閒置 20 分鐘以上，執行
   `bash scripts/perf/measure-public.sh https://expense-tracker-api-gmpi.onrender.com/api 3`
   記錄第 1 次和之後幾次的 TTFB 和總計。重複 3 輪（每輪之間都要再閒置 20 分鐘）。
3. **啟動時間**：Render → Logs 搜尋 `STARTUP`，記下 `flyway=`、`ready=`、`cpus=`、`maxHeap=`。
4. **登入與 Dashboard**：用電腦瀏覽器開 `https://<前端網址>/?perf=1`，開啟開發者工具 Console：
   - 暖機狀態下登出再登入，各做 3 次；每次登入前先輸入 `__perf.clear()`，登入完成約 5 秒後輸入 `__perf.summary()`，截圖或複製表格。
   - 「登入後載入資料」那一行就是登入後的總等待時間。
   - 註冊需要新的 Email，做 1–2 次即可；Email 驗證碼的寄送時間另外記錄。
5. **伺服器端拆解**：Render → Logs 搜尋 `TIMING`，複製同一時段的紀錄（裡面沒有 Email 或 token，可以直接貼給我）。
6. 記錄量測環境：裝置、瀏覽器、網路（Wi-Fi／4G）、所在城市、量測時間。
7. **資料庫方案確認**（只看後台、不修改）：Render 後台確認沒有掛 Render PostgreSQL；Neon 後台確認方案、區域、autosuspend 時間、可還原的時間範圍、目前用量。
8. 量完把 `SERVER_TIMING_ENABLED` 刪除；前端網址加 `?perf=0` 關閉紀錄。

## 5. 正式環境基準（待填）

| 情境 | 第 1 次 | 第 2 次 | 第 3 次 | 備註 |
|---|---|---|---|---|
| 閒置 20 分鐘後 `/health` 總計 | | | | |
| `STARTUP ready=` | | | | |
| 暖機後 `POST /auth/login`（前端 ms／伺服器 app ms／db ms） | | | | |
| 暖機後「登入後載入資料」（ms／請求數） | | | | |
| 註冊（前端 ms，含／不含驗證碼寄送） | | | | |
| `GET /dashboard-settings` 伺服器 app ms | | | | |

樣本少於 20 筆時只列每次的實測值，不計算 p95。

## 6. 無法查看的項目

Render：實際方案、CPU 和記憶體上限、休眠與喚醒事件、GC 和 OOM 紀錄、log 保存時間。
Neon：方案、autosuspend 設定、可還原範圍、儲存用量、連線數上限，以及**備份與還原演練紀錄（目前沒有，見 `BETA_RELEASE_CHECKLIST.md` B7）**。

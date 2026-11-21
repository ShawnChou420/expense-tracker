# Woolworths 本週特價：資料來源、同步與部署

## 資料來源

| 方式 | 說明 |
|---|---|
| CSV 資料源網址（自動） | 每週三 07:00（Australia/Sydney）由排程從 `SPECIALS_FEED_URL` 拉取 CSV，例如自己維護並「發佈到網路（CSV）」的 Google 試算表，或日後取得授權的資料供應者 |
| 管理後台上傳 CSV（手動） | 更多 → 管理後台 → 特價 → 選擇 CSV → 預覽 → 正式匯入 |

**不直接擷取 woolworths.com.au。** 網站條款 1.4(b)(viii) 禁止以 robot、spider 或其他機制擷取網站內容；網站內部 endpoint 也不是公開授權的 API。
程式透過 `WoolworthsSpecialsCollector` 介面取得資料，之後若取得授權資料來源，只要新增一個實作，不需要改資料庫、API 或前端。

### CSV 欄位

第一列必須是欄位名稱，範例見 `docs/supermarket-specials-sample.csv`（範例資料，不是真實價格）。

| 欄位 | 必填 | 說明 |
|---|---|---|
| `external_product_id` | ✅ | 商品代號（英數字、`-`、`_`），建議用 Woolworths 商品頁網址裡的 stockcode |
| `name` | ✅ | 品名 |
| `sale_price` | ✅ | 特價，以「元」填寫（`2.50` 或 `$2.50`），最多兩位小數 |
| `promotion_start` / `promotion_end` | ✅ | `YYYY-MM-DD`，結束日當天仍有效 |
| `regular_price` | | 原價；有填才會計算折扣 % 與「省多少」 |
| `promotion_type` | | `HALF_PRICE`、`PRICE_DROP`、`MULTI_BUY`、`OTHER`（預設） |
| `brand`、`package_size`、`category`、`unit_price` | | 不確定就留空，系統不會自行補值 |
| `product_url` | | 必須以 `https://www.woolworths.com.au/` 開頭 |

## 同步規則

- 同一商品以 `(supermarket_code, external_product_id)` 去重；同一商品、同一地區、同一期開始日只有一筆特價。重新同步同一期時更新價格，不同期另存一筆，保留價格歷史。
- 同步失敗時整批回滾、紀錄標成失敗，不刪除任何既有資料。採買清單存的是加入當下的價格快照，不會被同步改變。
- 避免重複執行：程序內旗標、「30 分鐘內未結束的同步」檢查，加上交易層級的 PostgreSQL advisory lock。
- 排程失敗（取得資料或寫入資料庫失敗）時，每隔 `SPECIALS_SYNC_RETRY_MINUTES` 分鐘重試，最多 `SPECIALS_SYNC_MAX_ATTEMPTS` 次。資料本身有錯不會重試。
- `GET /api/supermarkets/specials/status` 會回傳最後成功同步時間、特價有效日期、是否可能過期（`stale`）。前端據此顯示「價格可能已過期」。

## 環境變數（都是選填）

| 變數 | 預設 | 說明 |
|---|---|---|
| `SPECIALS_FEED_URL` | （空） | CSV 資料源網址，必須是 https（本機開發可用 `http://localhost:` 或 `http://127.0.0.1:`）。沒設定時排程自動跳過 |
| `SPECIALS_FEED_TOKEN` | （空） | 資料源需要憑證時，以 `Authorization: Bearer` 送出；不會寫進紀錄 |
| `SPECIALS_SYNC_TOKEN` | （空） | 外部排程觸發端點的密鑰，至少 24 字元；沒設定時端點回 404 |
| `SPECIALS_REGION` | `NSW` | 同步資料的地區代碼（`NSW` 或 `NSW-2000`） |
| `SPECIALS_SYNC_CRON` | `0 0 7 * * WED` | Spring cron，時區固定 Australia/Sydney |
| `SPECIALS_SYNC_MAX_ATTEMPTS` | `3` | 失敗重試上限（含第一次） |
| `SPECIALS_SYNC_RETRY_MINUTES` | `30` | 重試間隔 |

## 本機執行

```bash
# 後端（需要本機 PostgreSQL）
cd backend
SPECIALS_FEED_URL=http://127.0.0.1:18090/specials.csv \
DB_URL=jdbc:postgresql://127.0.0.1:5432/expense DB_USER=postgres \
bash gradlew bootRun

# 前端
npm run dev
```

用管理員帳號進入「更多 → 管理後台 → 特價」，可以上傳 CSV，或按「立即從資料源同步」。

## Render 部署

1. 在 Render 後端服務的 Environment 設定 `SPECIALS_FEED_URL`；需要的話再設定 `SPECIALS_FEED_TOKEN`。
2. 後端目前是付費常駐方案，內建排程會每週三 07:00 自動執行，**不需要**外部排程。
3. 如果之後改回會休眠的方案，可設定 `SPECIALS_SYNC_TOKEN`，再用外部排程（例如 cron-job.org、GitHub Actions）在每週三 07:00 呼叫：

   ```bash
   curl -X POST https://<後端網址>/api/internal/supermarkets/sync -H "X-Sync-Token: <SPECIALS_SYNC_TOKEN>"
   ```

   同一時間被觸發兩次時（內建排程加上外部排程），第二次會收到 409，不會重複寫入。

## API

| 權限 | 路由 |
|---|---|
| 公開 | `GET /api/supermarkets/specials`：keyword、category、halfPriceOnly、supermarket（目前只接受 WOOLWORTHS）、storeCode、page、size（≤ 50）、sort（discount／price／ending／name） |
| 公開 | `GET /api/supermarkets/specials/{id}`、`GET /api/supermarkets/specials/status`、`GET /api/supermarkets/categories` |
| SUPER_ADMIN | `POST /api/admin/supermarkets/sync`：body 有 `csv` 時上傳（`dryRun` 預設 true），沒有時從資料源同步；`GET /api/admin/supermarkets/sync-logs` |
| X-Sync-Token | `POST /api/internal/supermarkets/sync` |
| 會員 | `/api/shopping-lists`（取得清單、加入／修改／刪除品項、完成採買並記成一筆支出） |

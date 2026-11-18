# Today Dashboard（今日首頁）

首頁的上半部改成「今天」：問候與日期 → 今日工作 → 今日待辦 → 給今天的你，一句話 → 心情與備註 → 本週財務（原有內容，全部保留）。

## 設計決定

| 項目 | 做法 |
| --- | --- |
| 今日薪資 | 不另寫計薪公式。首頁直接讀班表上由 `useShiftCalculator` 算好的 `grossPay`、`paidMinutes`、`smokoDeductMinutes`（`src/domain/today.js`）。 |
| 未設定費率 | `setup.payReady` 為 false 時不顯示金額，改顯示「尚未設定薪資費率」與「上傳 Payslip／手動設定」。 |
| 班次順序 | 正在上班 → 今天稍後的班 → 今天剛結束的班 → 之後最近一班。「最近完成」只看今天結束的班。 |
| 跨午夜 | Shift Date＝開始那天；結束時間落在隔天，凌晨仍顯示「正在上班」。 |
| 時區 | 系統原本沒有時區設定。前端一律用裝置本地時間（`new Date(年,月,日,時,分)`，夏令時間由瀏覽器處理）；後端的「今天」由前端傳本地日期，且只接受與 UTC 日期相差一天以內的日期，涵蓋所有澳洲州別。之後若要依「工作所在地」而非手機時區，可在 `work_profile` 加 `time_zone`（IANA，例如 `Australia/Perth`）。 |
| 待辦重複 | 規則（`daily_task`）與每一天的完成（`daily_task_completion`）分開；每一次由規則即時推算，不預先產生資料列，重新整理不會多出任務。每月 31 號在小月落在月底。 |
| 之前未完成 | 只計單次待辦；不自動刪除、不改日期，使用者選擇完成／移到今天／保留原日期／刪除。 |
| 備註 | 明確「儲存」按鈕；失敗時內容留在輸入框並顯示失敗狀態。心情一鍵即存，只送 `mood`，不會清掉備註。 |
| 隱私 | 備註、心情只限本人；不寫進活動紀錄或 log、管理後台不讀取、不傳送給外部服務。 |
| 每日小語 | 每人每天一句（`UNIQUE(user_seq, quote_date)`＋`ON CONFLICT`，並發只有一筆）；只取 id 在程式裡隨機挑，不用 `ORDER BY random()`；避開最近 30 天 → 7 天 → 只避開目前這句。「換一句」每天最多 10 次、2 秒內連點只算一次；換掉的也記入 `user_quote_history`，去重不受影響（保存 60 天）。 |
| 訪客 | 待辦、備註只在記憶體；小語用 `GET /api/daily-quotes/sample`（依日期固定一句、不寫資料庫、不能換）。 |
| AI 小語 | 只預留 `QuoteGenerationService` 介面與約定，沒有任何實作或外部服務。 |

## API

全部從登入 token 取得會員，不接受指定其他 user_seq；別人的待辦一律 404。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/today?date=` | 一次取回今日待辦、之前未完成、備註心情、小語（小語失敗時 `quote: null`） |
| GET | `/api/daily-tasks?date=` | 某天的待辦（含重複待辦當天那一次） |
| GET | `/api/daily-tasks/overdue?today=` | 今天以前未完成的單次待辦 |
| POST | `/api/daily-tasks` | `{title, description?, taskDate, repeatType?}` |
| PATCH | `/api/daily-tasks/{id}` | 修改欄位，或 `{completed, occurrenceDate}` 勾選（重複待辦只影響那一天） |
| DELETE | `/api/daily-tasks/{id}` | 刪除（重複待辦連同各天完成紀錄） |
| GET | `/api/daily-journal?date=` | 沒有紀錄時回傳空內容 |
| PUT | `/api/daily-journal/{date}` | `{content?, mood?}`，只更新有傳的欄位 |
| GET | `/api/daily-quotes/today?date=` | 今日小語：quoteId、content、category、language、author、source、sourceType、quoteDate、refreshesLeft |
| POST | `/api/daily-quotes/refresh` | `{date}`，換一句 |
| GET | `/api/daily-quotes/sample?date=` | 訪客用，不需登入 |

CORS 允許的方法加上 `PATCH`。

## Migration

- **V11**：`daily_task`、`daily_task_completion`、`daily_journal`、`daily_quote`、`user_daily_quote`、`user_quote_history`。只新增資料表，不修改既有資料。會員私人資料表都已加入 `AuthService.ACCOUNT_DELETE_STATEMENTS`。
- **V12**：100 句原創繁體中文小語（6 類，每句 20–60 字），`ON CONFLICT (content) DO NOTHING`，只執行一次。

回滾（需要時手動執行）：

```sql
DROP TABLE IF EXISTS user_quote_history, user_daily_quote, daily_quote, daily_journal, daily_task_completion, daily_task;
DELETE FROM flyway_schema_history WHERE version IN ('11', '12');
```

## 尚未實作

語錄收藏、分類偏好、中英文切換、AI 生成、自訂「一天從幾點開始」（Life Day）、睡眠紀錄（`sleep_minutes` 已預留）、在首頁瀏覽其他日期的待辦（目前可在新增／編輯時選日期）、重複待辦的「結束日期」與錯過的重複待辦提醒。

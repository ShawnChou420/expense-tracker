# Expense Tracker 專案交接指南

> 狀態快照：2026-11-10，`main` / `0ce2560`；2026-11-13 補記 `account-page` 分支（`5a9bf16`）的會員頁與密碼規則。此文件供協作開發快速上手；開始任何新任務前，仍須重新閱讀相關程式、確認 `git status` 和實際資料庫狀態。舊需求文件描述的是目標，不保證已全部實作。

## 產品與目前範圍

這是給澳洲打工生活使用的手機優先工具，現有五個底部分頁：Dashboard、薪資預估、車資、採買、支出。Web 使用 Vue 3 + Vite + Vant；Android 使用 Capacitor 包裝同一個前端；會員資料透過 Spring Boot API 存入 PostgreSQL。沒有 Vue Router 或 Pinia。不要把它當作全新專案重做，也不要在沒有需求與測試的情況下改動薪資規則。

| 功能 | 主要位置 | 目前語意 |
| --- | --- | --- |
| 導覽、薪資日曆與班表、JSON/XLSX 匯入匯出、登入協調 | `src/App.vue` | `activeTab` 切頁；工作紀錄與資料匯入流程仍在此處 |
| 薪資核心 | `src/composables/useShiftCalculator.js`、`src/utils/holidays.js`、`src/utils/workRecord.js` | 以現有規則估算，不代表實際入帳；修改前先跑 characterization tests |
| 車資與乘客 | `src/components/TripTracker.vue`、`src/domain/trips.js`、`src/domain/tripStats.js` | 支援每位乘客不同車資、待收與部分收款 |
| 支出與固定支出 | `src/components/ExpenseTracker.vue`、`src/domain/expenses.js` | 單次/週期支出與實際付款分開；投資虧損另有特殊處理 |
| 採買清單 | `src/components/ShoppingList.vue`、`src/domain/shopping.js` | 這次/下次、優先順序、目標/已買數量、完成復原；**勾選不會建立支出** |
| Dashboard | `src/components/DashboardPage.vue`、`src/domain/dashboard.js` | 實際入帳、預估工作收入、已付支出、Saving 目標、指定工作日進度分開統計 |
| 會員資料頁 | `src/components/AccountPage.vue`、`src/domain/account.js`、`src/repositories/accountRepository.js` | 由頂部帳號卡開啟；顯示名稱、註冊日期、修改密碼、登出、刪除帳號（需再輸入密碼）。註冊/新密碼需 8 字元以上且含大小寫、數字、特殊符號 |
| 共用日期/金額 | `src/domain/date.js`、`src/domain/money.js` | 本地 `YYYY-MM-DD`；新財務領域邏輯以整數 AUD cents 運算 |
| 樣式 | `src/assets/base.css` | 共用 design tokens、頁面間距、safe area；維持既有藍白卡片風格 |

`src/components/HelloWorld.vue`、`TheWelcome.vue` 等仍是 Vite 範本殘留，並非目前產品頁面。圖表使用 Chart.js；前端是 JavaScript，只有局部 JSDoc/checkJs，**不是**完整 TypeScript 專案。

## 資料流與重要邊界

1. 訪客可試用薪資與部分清單功能。訪客班表、車資、支出、採買和設定保存在前端**記憶體**，重新整理或關閉會消失。不要宣稱訪客資料已永久保存，也不要未經需求加入 `localStorage`。
2. 登入後，前端經 `src/services/authSession.js` 的 `apiRequest` 加上 bearer token 呼叫 `/api`。`src/repositories/appRepositories.js`、`shoppingRepository.js`、`leaveBlackoutRepository.js` 等依登入狀態選擇訪客記憶體或會員 API。`src/composables/useWorkRecordsPersistence.js` 監看班表變動並序列化寫入會員 API。
3. 前端 token 只放記憶體，重新整理後需重新登入；登出要隔離會員畫面與訪客資料。`src/App.vue` 的登入流程會詢問是否匯入訪客資料，依 ID 略過已存在資料；**匯入目前不是原子交易**，改動此流程要檢查部分成功與重複匯入風險。
4. Web 本機開發時，Vite 將 `/api` 代理至 `127.0.0.1:8080`；Vue 不直接連 PostgreSQL。Capacitor 原生版需設定可連線的 HTTPS `VITE_API_BASE_URL`（含 `/api`）；未設定時原生登入不可用。切勿把真正的 API key、DB 密碼或 token 放入 `VITE_*` 變數、文件、commit 或回覆。
5. 後端由 Spring Security 驗證 token，從驗證身分決定資料 owner，不信任前端傳入的 user ID。現有 `backend/src/main/java/com/expensetracker/` 以 Controller + `JdbcTemplate` 為主，另有 `AuthService`；不是完整的 Service/DAO 分層，不要為小功能大幅改寫架構。

### 財務與日期語意

- `WorkRecord.grossPay` 是**預估稅前薪資**，不可直接放進「實際已入帳收入」。實際薪資要用 `salary_deposit` 的入帳日期與金額；稅後估算也不能冒充實際入帳。
- 車資已收金額按**收款日期**計入實際收入；待收只能列為應收/預估，部分收款不可重複加總。支出按**實際付款日期**計入現金流；固定支出排程不得與付款重複計算。Dashboard 的口徑集中在 `src/domain/dashboard.js`。
- 班表有自己的本地工作日期；跨午夜切段只供計薪，指定工作日仍按紀錄的 `workDate` 去重。週期為週一至週日，日期工具在 `src/domain/date.js`。
- 採買商品只有清單數量與安排，**目前沒有購買價格/比價歷史**。採買頁的「去記支出」目前只切換到支出頁，**沒有開啟或預填支出表單**。不要為每個已勾選商品自動記一筆支出，以免與收據總額重複。
- 指定工作日是個人標記與自訂目標，不是官方簽證資格判定。

### 薪資規則保護

`useShiftCalculator.js` 先依午夜分段為平日、週六、週日並辨識 NSW 公眾假日，再在對應時段扣 smoko，最後計算各項薪資。現有預設 smoko：滿 4 小時一次、滿 8 小時兩次，每次 30 分鐘；檔案還支援覆寫。週六前 180 個計薪分鐘為 time-and-a-half，其後 double；平日夜班 shift loading、週日與公眾假日另按目前程式計算。公眾假日的既有 penalty 是基礎費率的 150% 額外項，**不要憑字面猜測總倍率**。如需校正 payslip，先拿實際薪資單、工作時段和 `tests/useShiftCalculator.characterization.test.js` 對帳，再明確提出變更；不要順手改規則或丟掉原本計算註解。既有 JSON 匯入重算及 XLSX 匯出也需回歸驗證。

## 後端與資料庫

- Java 21、Spring Boot 4、Spring Security、JDBC、Flyway、PostgreSQL。設定見 `backend/src/main/resources/application.yml`；環境變數為 `DB_URL`、`DB_USER`、可選 `DB_PASSWORD`、`API_PORT`、`CORS_ORIGINS`。不要輸出真實憑證或完整含密碼 URL。
- 認證端點在 `AuthController.java`；工作/支出在 `LedgerController.java`；薪資入帳/設定/付款在 `FinanceController.java`；乘客/行程/收款在 `TransportController.java`；禁休與採買分別在 `LeaveBlackoutController.java`、`ShoppingController.java`；會員資料/修改密碼/刪除帳號在 `AccountController.java`（`/api/account`，邏輯在 `AuthService`）。修改密碼會撤銷同會員其他 session；刪除帳號在單一交易內刪除所有含 `user_seq` 的私人資料表，新增此類資料表時必須加入刪除清單（`AccountDeletionTest` 會掃描 migration 檢查）。所有私人 API 必須限制為登入者資料。
- Migration 位於 `backend/src/main/resources/db/migration/`，現有 V1–V6。V1 供全新空 DB；既有六表資料庫需先審查並明確 baseline，**不可**盲目開啟 `baseline-on-migrate`、`ddl-auto=update`、刪表或重新歸屬舊資料。詳見 `backend/README.md` 與歷史盤點 `backend/DB_AUDIT.md`。
- **2026-11-10 的本機唯讀檢查：Flyway 最新成功版本為 V5，`shopping_item` 表不存在。**程式碼有 V6 和採買 API，不代表正在運行的後端或本機 DB 已套用。會員採買保存要先確認這是開發 DB、完成備份，再由受控重啟/遷移套用 V6；不要在交接時擅自改動使用者 DB。
- 登入採用記憶體 bearer credential（後端只存 token digest），不是 cookie session。正式上線前仍需 HTTPS、正式 CORS、備份/還原演練、郵件驗證、忘記密碼和更完整的登入防護。不要假裝這些已完成。

## 本機執行與檢查

從專案根目錄執行：

```sh
npm install
npm run dev
npm run test
npm run lint
npm run format:check
npm run typecheck
npm run build
```

啟動會員 API 前，先在自己的 shell 設定 `DB_URL`、`DB_USER` 等環境變數，再到 `backend` 執行 `bash gradlew bootRun`；Java 測試為 `cd backend && bash gradlew test`。Android 靜態資產更新可用 `npm run android:sync`，再以 `npm run android:open` 開 Android Studio；**Web build 成功不等於手機已更新或實機測試通過**。

2026-11-10 檢查結果：前端 Vitest **12 個檔案、54 個測試通過**；`npm run lint`、`npm run format:check`、`npm run typecheck`、`npm run build` 與後端 `bash gradlew test --no-daemon` 均通過。Vite build 有單一 bundle 大於 500 kB 的警告。注意目前 `lint`、`format:check` 腳本**未涵蓋所有 Vue 檔案**（例如 `App.vue`、`ShoppingList.vue`、`DashboardPage.vue`），`typecheck` 的 `tsconfig.json` 只包含 `src/domain/**/*.js` 與 `src/repositories/**/*.js`；不要把通過結果解讀成全專案 Vue 型別或格式已驗證。這次未執行 Android sync 或實機測試。

2026-11-13 在 `account-page`（`5a9bf16`）重跑：Vitest **18 個檔案、87 個測試通過**；lint（現已涵蓋 `AccountPage.vue`）、format:check、typecheck、build 與後端 `bash gradlew test` 均通過。會員頁未做瀏覽器手動操作或對真實 DB 驗證。

## 協作開發守則

1. 接新任務先 `git status --short`，保留使用者未提交變更；閱讀相關元件、domain、repository、API、migration 與測試，不要只憑本文推斷現況。
2. 以最小變更維持現有 Vue/Vant/Capacitor 視覺與資料流。計算放 domain/composable，資料存取放 repository/API；不要把新統計散落在畫面元件中。
3. 新增私人資料時，檢查會員歸屬、金額 cents、實際收付款日期、訪客/會員切換，以及是否需要版本化 migration。不要將展示/預估資料混進實際入帳。
4. 修改薪資、收付款、班表匯入、採買完成等行為時補回歸測試，執行相關前後端檢查。對未驗證的 DB migration、Android 實機、瀏覽器操作或部署，明確標示「未驗證」。
5. `EXPENSE_TRACKER_CORE_FEATURES.md` 和 `CAPACITOR_ANDROID_PLAN.md` 是較早的需求/規劃；`README.md` 仍是 Vite 範本。以**目前程式碼及這次新任務**為準，遇到衝突先釐清，不要擅自實作過去尚未完成的 Phase。

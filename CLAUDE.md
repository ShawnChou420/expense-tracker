# Expense Tracker：給 Claude 的專案規則

澳洲打工度假（WHM）個人記帳 App：班表與薪資試算、車資、支出、存款、採買清單。
使用者是專案擁有者本人，請一律用**繁體中文**回覆、寫 PR 說明與 issue 留言。程式碼註解中英文皆可，跟隨該檔案現有風格。

## 架構

- 前端：根目錄就是 Vue 專案（Vite、Vant、Chart.js），沒有 Router 與 Pinia，頁面切換在 `src/App.vue`。
  - 計算邏輯放 `src/domain/`（純函式、可測試），資料存取放 `src/repositories/`（訪客＝記憶體，會員＝API）。
  - 薪資核心：`src/composables/useShiftCalculator.js`、NSW 國定假日：`src/utils/holidays.js`。
- 後端：`backend/`，Spring Boot 4 + Java 21 + JdbcTemplate + Flyway。`backend/gradlew` 會轉呼叫 `android/gradlew`。
- 資料庫：正式環境是 Neon PostgreSQL；migration 在 `backend/src/main/resources/db/migration/`。
- Android：Capacitor（`android/`）。
- 部署：`render.yaml`。**merge 到 `main` 會自動部署到 Render 正式環境**，後端啟動時 Flyway 會自動對正式資料庫套用新的 migration。

## 必須遵守

1. **不要直接 push 到 `main`。** 一律開新分支、開 PR，由使用者審核後 merge。
2. **新增或修改 Flyway migration、刪除欄位或資料表，必須先在 issue／PR 說明影響並取得使用者同意。** 已套用的 migration（V1–V6）絕對不可修改，只能新增下一個版本。
3. **不要修改 `render.yaml`、`backend/Dockerfile`、`.dockerignore`、部署相關環境變數**，除非使用者明確要求。
4. 不要讀取、輸出或 commit `.env`、`.env.local`、token、密碼、資料庫連線字串。
5. 金額在 domain 與資料庫一律用**整數 cents**（AUD）；日期用本地 `YYYY-MM-DD`，避免 UTC 轉換造成日期偏移（用 `src/domain/date.js`）。
6. 薪資、稅務等計算放在 `src/domain/`，並附 Vitest 測試；不要把計算寫進 Vue template。
7. 稅率、級距等會隨年度變動的數字不可寫死在程式裡，要能依所得年度（7/1–6/30）設定；不確定的稅務規則要在 PR 中標明「需以 ATO 公告確認」，不要自行猜測。
8. 「指定工作日」功能只是個人紀錄，不可描述成官方簽證資格判定。
9. 保留既有薪資計算行為；要改變計算結果時，先用測試固定現有行為，並在 PR 中說明差異。
10. 只做 issue 要求的範圍，不順手重構無關程式。

## 提交 PR 前

在本機或 CI 確認以下檢查通過（CI：`.github/workflows/ci.yml`）：

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
bash backend/gradlew test
```

PR 說明需包含：做了什麼、為什麼、如何驗證、是否影響資料庫或部署、尚未完成的部分。

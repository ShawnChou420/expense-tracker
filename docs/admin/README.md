# 管理後台（Super Admin）

會員帳號、操作紀錄與管理員稽核。管理員沿用一般登入；擁有 `SUPER_ADMIN` 角色的帳號會在「更多」看到「管理後台」，網址為 `/#/admin`。

## 1. 初始化第一位 SUPER_ADMIN

> 只在擁有者自己的電腦上執行。資料庫連線字串只放在自己 shell 的環境變數，**不要寫進檔案、不要 commit**。
> 沒有任何公開 API 可以授予角色，使用者也不能自己選角色。

```sh
# 1) 在自己的 shell 設定連線（從 Neon 主控台複製，不要存檔）
export DATABASE_URL='postgresql://...'

# 2) 查出自己帳號的內部 user_seq（唯讀）
bash backend/gradlew adminRole --args="find you@example.com"
#   → user_seq=12  狀態 ACTIVE

# 3) 授予：會顯示目標 Email，需再輸入同一個 Email 確認；不一致就取消、不變更
bash backend/gradlew adminRole --args="grant 12 --reason 初始化擁有者帳號"

# 4) 確認
bash backend/gradlew adminRole --args="list"
#   也可重新登入 App：/api/auth/me 回傳 roles 含 SUPER_ADMIN，「更多」出現「管理後台」

# 5) 撤銷（最後一位 SUPER_ADMIN 不能撤銷）
bash backend/gradlew adminRole --args="revoke 12 --reason 不再擔任管理員"

# 6) 結束後清掉連線字串
unset DATABASE_URL
```

- 可重複執行：已經是管理員不會重複新增。
- 每次授權／撤銷都寫入 `admin_audit_log`（`admin_seq` 為空、`details.via = "CLI"`）。
- 停用中的帳號不能被授予。
- 也可在後台「會員 → 授予／撤銷管理員」操作（需輸入自己的密碼重新驗證）。

## 2. 權限與安全

| 層 | 做法 |
| --- | --- |
| 路由 | `SecurityConfig`：`/api/admin/**` 需 `ROLE_SUPER_ADMIN`，未登入 401、一般會員 403（並記錄 `ADMIN_ACCESS_DENIED`） |
| 方法 | `AdminController` 每個方法第一行 `requireAdmin(auth)`（測試會掃描原始碼確認） |
| 角色來源 | 每次請求由 token 查 `user_role`，撤銷立即生效；停用帳號的 token 直接失效 |
| 敏感操作 | 停用、恢復、授予／撤銷、刪除都需重新輸入管理員密碼；刪除另需輸入會員 Email |
| 保護 | 不能停用或刪除自己；最後一位 SUPER_ADMIN 不能被撤銷、停用或刪除 |
| 原因 | 所有寫入操作都必須填寫原因（5–500 字），連同結果寫入稽核 |
| ID 猜測 | 所有會員 API 都在管理員權限之後；一般會員 API 一律以 token 的 user_seq 為範圍，不接受外部指定 ID |

**MFA 建議**：目前以「敏感操作重新輸入密碼」作為第二道驗證。建議下一步為 SUPER_ADMIN 加上 TOTP（Authenticator App），登入後台與敏感操作時要求 6 位數碼；本 PR 尚未實作。

## 3. API

全部需要 `Authorization: Bearer <token>` 且角色為 SUPER_ADMIN。每個回應都帶 `X-Request-Id`。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/admin/overview` | 會員數（總數、啟用、停用、7 天新註冊、7 天有登入、管理員）、事件統計、最近錯誤 |
| GET | `/api/admin/users?q&status&page&size` | 會員列表；`q` 比對 Email 或會員 ID；`status` = ACTIVE/DISABLED；`size` ≤ 100 |
| GET | `/api/admin/users/{seq}` | 會員詳細（不含密碼、token、薪資單內容） |
| GET | `/api/admin/users/{seq}/events?page` | 會員操作紀錄 |
| GET | `/api/admin/events?from&to&userSeq&type&status&category&page&size` | 全站事件；日期為雪梨時間 `YYYY-MM-DD` |
| GET | `/api/admin/audit?targetSeq&page` | 管理員稽核紀錄（唯讀） |
| PUT | `/api/admin/users/{seq}/profile` | `{nickname, reason}` |
| POST | `/api/admin/users/{seq}/disable` | `{reason, password}`；同時撤銷該會員所有登入 |
| POST | `/api/admin/users/{seq}/enable` | `{reason, password}` |
| PUT | `/api/admin/users/{seq}/role` | `{superAdmin: true/false, reason, password}` |
| POST | `/api/admin/users/{seq}/delete` | `{reason, password, confirmEmail}`；永久刪除會員私人資料 |

會員端新增：`POST /api/events`（只接受 `PAYSLIP_IMPORT_FAILED`、`FILL_MONTH_COMPLETED`，每人每小時 60 筆）；`/api/auth/login|register|me` 回傳 `roles`。

尚未實作：邀請會員（原規格提到的邀請流程不在本 PR 範圍）。

## 4. 操作紀錄（user_activity_event）

| 分類 | 事件 |
| --- | --- |
| USER | REGISTER_SUCCESS、LOGIN_SUCCESS、LOGIN_FAILED、LOGOUT、ACCOUNT_DELETED、WORK_SETUP_COMPLETED、SHIFT_CREATED、SHIFT_UPDATED、FILL_MONTH_COMPLETED、EXPENSE_CREATED、EXPENSE_UPDATED、VISA_TRACKING_ENABLED、VISA_HISTORY_IMPORTED |
| PAYSLIP | PAYSLIP_IMPORT_SUCCESS、PAYSLIP_IMPORT_FAILED（錯誤代碼如 WRONG_PASSWORD、DUPLICATE_FILE） |
| API_ERROR | 未預期的 500（錯誤代碼為例外類別名稱） |
| DATABASE | DB_ERROR、DB_CONSTRAINT_VIOLATION |
| ADMIN_SECURITY | ADMIN_ACCESS_DENIED |

- 不記錄：密碼、token、Email、薪資單內容、金額明細、stack trace。`details` 只保留數字、布林與 40 字以內且不含 `@` 的短字串，最多 8 項。
- Stack trace 只寫到伺服器 log，用 Request ID 對照（log 格式 `TIMING rid=...`）。
- 保存 180 天，每天 03:30（雪梨）自動清除。會員刪除帳號時一併刪除，只留下一筆不含個資的 ACCOUNT_DELETED（僅會員 ID），180 天後同樣清除。

## 5. 稽核（admin_audit_log）

- 欄位：管理員、目標會員、動作、原因、結果（SUCCESS/FAILURE）、細節、Request ID、時間。
- 只能新增：資料庫 trigger 禁止 UPDATE；DELETE 只允許超過 2 年的紀錄。後台與 API 都沒有修改或刪除稽核的功能。
- 會員被刪除後稽核仍保留（只留會員 ID，不留 Email）。

## 6. Migration V10

新增：`user_info.account_status`（預設 ACTIVE）、`user_info.status_changed_at`、資料表 `user_role`、`user_activity_event`、`admin_audit_log`，以及 trigger `protect_admin_audit_log`。

- 只新增欄位與資料表，不修改、不刪除既有資料；既有會員全部是 ACTIVE、沒有角色。
- 部署後沒有任何管理員，需依第 1 節手動初始化。
- 回滾（需要時手動執行）：

```sql
DROP TRIGGER IF EXISTS trg_protect_admin_audit_log ON admin_audit_log;
DROP FUNCTION IF EXISTS protect_admin_audit_log();
DROP TABLE IF EXISTS admin_audit_log, user_activity_event, user_role;
ALTER TABLE user_info DROP COLUMN IF EXISTS status_changed_at, DROP COLUMN IF EXISTS account_status;
DELETE FROM flyway_schema_history WHERE version = '10';
```

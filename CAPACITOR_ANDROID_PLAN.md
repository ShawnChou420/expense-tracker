# 將 Expense Tracker 包裝成 Android App

## 1. 任務目標

將目前既有的 Vue Expense Tracker 專案使用 Capacitor 包裝成 Android App，讓它可以透過 Android Studio 安裝到實體 Android 手機測試。

這一階段的目標是建立可執行的 Android 測試版本，不是發布到 Google Play。

## 2. 專案現況

- 前端框架：Vue（請先檢查 `package.json`，確認實際 Vue、Vite 和 Node 版本）
- UI：沿用現有畫面與元件
- 所有計算邏輯目前都在前端
- 尚未串接 Spring Boot
- 尚未串接 PostgreSQL
- 尚未部署到 Vercel
- 現階段不需要網路 API
- 目標平台：Android
- 測試裝置：Samsung Galaxy Z Flip 系列

## 3. 實作原則

1. 保留現有 Vue 架構及功能，不要將前端重寫成 Kotlin、Java 或其他框架。
2. 使用 Capacitor 將既有 Vue build output 包裝成 Android App。
3. 修改前先閱讀專案結構、`package.json`、Vite 設定及路由設定，不要預設所有專案都使用相同配置。
4. 優先進行最小且可逆的修改。
5. 不要在這個階段加入 Spring Boot、PostgreSQL、Vercel、登入系統或 Android Widget。
6. 不要刪除或重構與本任務無關的既有程式碼。
7. 不要提交金鑰、簽章檔、密碼或其他敏感資訊。
8. 若工作目錄已有使用者尚未提交的修改，必須保留，不能覆蓋或還原。

## 4. 執行前檢查

請先完成以下檢查，並簡短回報結果：

1. 閱讀 `package.json`，確認 package manager、scripts、Vue 和 Vite 版本。
2. 確認專案實際的 build 指令。
3. 確認 build output directory，Vite 通常為 `dist`，但必須以現有設定為準。
4. 檢查是否已經安裝 Capacitor，避免重複初始化。
5. 檢查是否已有 `capacitor.config.*` 或 `android/` 目錄。
6. 先執行現有測試、lint（若有）以及 production build，記錄原始狀態。
7. 若 production build 原本就失敗，先說明錯誤，不要把既有問題誤認為本次修改造成。

## 5. 實作內容

### 5.1 安裝 Capacitor

依照專案目前使用的 package manager，加入相容版本的套件：

- `@capacitor/core`
- `@capacitor/cli`
- `@capacitor/android`

不要盲目指定過舊版本；請使用彼此相容且符合目前 Node 環境的版本。

### 5.2 初始化設定

建立或更新 Capacitor 設定，預設資料如下：

- App name：`Expense Tracker`
- App ID：`com.shawn.expensetracker`
- Web directory：使用專案實際的 build output directory

如果 App ID 已存在，請保留既有值並回報，不要擅自更換。

設定檔預期概念如下，但應依專案實際語言和設定調整：

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shawn.expensetracker',
  appName: 'Expense Tracker',
  webDir: 'dist'
};

export default config;
```

### 5.3 建立 Android 平台

1. 先完成 Vue production build。
2. 如果尚未存在 Android 平台，執行 `npx cap add android`。
3. 執行 `npx cap sync android`。
4. 不要直接手動複製 build output 到 Android 目錄。
5. 確認 Capacitor 能辨識 Android 平台且同步成功。

### 5.4 增加開發指令

如果符合現有專案習慣，可在 `package.json` 增加清楚的 scripts，例如：

```json
{
  "scripts": {
    "android:sync": "npm run build && npx cap sync android",
    "android:open": "npx cap open android",
    "android:run": "npm run build && npx cap sync android && npx cap run android"
  }
}
```

請依實際 package manager 及既有 scripts 調整，不要破壞原本指令。

### 5.5 手機畫面基本檢查

檢查目前畫面是否至少具備：

- 正確的 viewport 設定
- 小螢幕不產生不必要的水平捲動
- 輸入金額時，軟體鍵盤不會完全遮住主要按鈕
- 上下安全區域不會遮住重要內容

只修正會阻擋 Android 測試的明顯問題，不要在本任務大幅重新設計 UI。

## 6. 資料保存限制

請檢查目前資料實際保存在哪裡，並在完成報告中清楚說明：

- 如果只存在 Vue runtime state，關閉或重啟 App 後資料會消失。
- 如果使用 `localStorage`、IndexedDB 或其他方法，說明 Android WebView 中的實際行為。
- 這個階段不要自行導入 SQLite 或後端資料庫，除非使用者另外要求。

## 7. 暫不處理的功能

以下內容不屬於本次範圍：

- Spring Boot API
- PostgreSQL
- Vercel 部署
- Google Play 上架
- 正式 release signing
- Android Home Screen Widget
- Samsung Z Flip Cover Screen Widget
- 推播通知
- 雲端同步
- 登入與多使用者功能

可以記錄後續建議，但不要在本次直接實作。

## 8. 驗證方式

修改完成後，至少執行：

1. 專案既有測試（若有）。
2. lint 或 type check（若專案有對應 script）。
3. Vue production build。
4. `npx cap sync android`。
5. `npx cap doctor` 或相當的環境檢查。
6. 確認 Android 專案可以被 Android Studio 開啟。

如果執行環境具有完整 Android SDK，再嘗試 Android debug build。若環境缺少 Android Studio、SDK 或 JDK，請明確列出缺少項目及使用者下一步，不要宣稱已成功產生 APK。

## 9. 完成條件

本任務完成時應符合：

- 現有 Vue 網頁功能仍可正常 build。
- 專案已加入有效的 Capacitor 設定。
- 已建立 Android 平台或明確說明無法建立的環境原因。
- Web assets 可以成功同步到 Android 專案。
- 使用者有清楚且可重複的更新流程。
- 沒有加入本次範圍外的大型功能。
- 沒有提交敏感檔案。

## 10. 完成後回報格式

請在最後回報：

1. 修改了哪些檔案。
2. 安裝了哪些套件及版本。
3. 執行了哪些驗證，以及各自結果。
4. 是否成功建立 Android 專案。
5. 是否成功產生 debug APK；若沒有，原因是什麼。
6. 使用者如何在 Android Studio 安裝到實體手機。
7. 之後每次修改 Vue 後，如何更新 Android App。
8. 目前資料關閉 App 後是否會保留。
9. 尚未完成或需要使用者決定的項目。

## 11. 預期的日常更新流程

完成設定後，使用者應可以透過類似以下流程更新 App：

```bash
npm run build
npx cap sync android
npx cap open android
```

如果專案實際使用的不是 npm，請換成對應的 package manager，並在完成報告中提供正確指令。

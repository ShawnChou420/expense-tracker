# Expense Tracker 核心功能開發規格

## 1. 文件目的

本文件定義現有 Expense Tracker 的下一階段功能。請 Codex 在完整閱讀現有專案、`package.json`、路由、狀態管理、Capacitor 設定及既有薪資計算邏輯後，再依本文件分階段實作。

本次核心方向不是重做現有 App，而是將既有「薪資計算與排班預估」擴充成適合澳洲打工度假使用的收入、支出、車資及指定工作紀錄工具。

## 2. 產品目標

使用者應能快速回答以下問題：

1. 我本週實際賺了多少？
2. 我本週花了多少？
3. 扣除房租與生活支出後，本週實際存下多少？
4. 哪些車資已收、哪些尚未收？
5. 我記錄了多少個指定工作日？

核心計算：

```text
實際 Weekly Saving
= 已收到的工作收入
+ 已收到的車資
- 已支付的房租
- 已支付的生活支出
```

另提供預估值：

```text
預估 Weekly Saving
= 預估工作收入
+ 全部應收車資
- 預估或已設定的房租
- 已記錄及預估生活支出
```

實際值與預估值必須分開呈現，不可混為同一個數字。

## 3. 目前技術與限制

- 既有前端：Vue + Vite。
- 既有 UI 元件：優先沿用專案目前使用的 Vant。
- 既有功能：薪資計算與排班預估，必須保留且不可破壞。
- Android 已透過 Capacitor 建立測試版；不要重複初始化或刪除既有平台。
- 架構需保留未來支援 iOS Capacitor 的可能性，不可將核心商業邏輯寫死在 Android 原生程式碼。
- 目前尚未完成 Spring Boot、PostgreSQL 及使用者登入。
- 不得將 `localStorage` 當成正式資料來源。
- 本階段若後端尚不存在，應建立清楚的 repository/service abstraction，並使用明確標示的暫存或 mock adapter；不得讓使用者誤以為資料已永久保存。
- 除非使用者另外要求，本任務不得自行建立 Spring Boot、PostgreSQL、登入系統或雲端部署。

## 4. 實作原則

1. 修改前先檢查現有資料結構與計算邏輯，能重用就重用。
2. 不要將 Vue 重寫成 Kotlin、Java、Swift 或其他前端框架。
3. 核心計算必須放在可測試的 composable、service 或 domain function，不要全部寫在 Vue template 中。
4. 金額計算避免直接依賴浮點數累加；使用既有 money utility，或以 cents 整數儲存及運算。
5. 日期使用明確的本地日期格式，避免 UTC 轉換造成日期前後偏移。
6. 優先做手機操作，桌面版仍需可用。
7. 每個階段完成後先執行測試與 build，再進入下一階段。
8. 保留使用者現有修改，不得刪除或重構與本任務無關的程式。

## 5. 導覽與資訊架構

手機版建議使用底部導覽，最多四個主要入口：

```text
首頁｜行事曆｜車資｜支出
```

指定工作日整合進行事曆及首頁統計，不需要先建立第五個主要頁籤。

全域提供「快速新增」入口，開啟 Action Sheet：

```text
新增工作紀錄
新增車資
新增支出
新增房租
```

如果現有專案已有不同導覽模式，請先提出整合方案，不要直接重做全部路由。

## 6. 功能 A：車資紀錄

### 6.1 使用情境

使用者上班或出去玩時可能搭載一至多人，雙方事先約定每人每趟或每次來回要收多少。App 用於記錄次數、應收金額及是否已付款，避免日後記錯。

### 6.2 行程欄位

- `id`
- 日期
- 行程類型：上班、出遊、其他
- 行程方式：單程、來回、自訂
- 備註，可選填
- 建立時間及更新時間
- 乘客清單

每位乘客的行程紀錄包含：

- 乘客 ID
- 顯示名稱
- 本次應收金額
- 付款狀態：待收、已收
- 實際收款日期，可選填

### 6.3 乘客名單

使用者應可：

- 建立常用乘客。
- 編輯名稱。
- 將乘客設為停用，但不得因此刪除歷史行程。
- 新增行程時直接多選乘客，不需每次重新輸入姓名。
- 設定乘客的預設單程／來回金額，但每次行程仍可覆寫。

### 6.4 車資統計

至少顯示：

- 本週應收總額。
- 本週已收總額。
- 尚未收款總額。
- 依乘客分組的未收款清單。
- 每位乘客的行程次數及累計金額。

未收車資不得計入「實際 Weekly Saving」，但可計入「預估 Weekly Saving」。

### 6.5 車資驗收情境

```text
9/20 上班來回
Kim：$8，已收
John：$8，待收
```

預期結果：

- 應收車資：$16。
- 已收車資：$8。
- 待收車資：$8。
- 實際 Weekly Saving 只增加 $8。
- 預估 Weekly Saving 增加 $16。

## 7. 功能 B：房租及生活支出

### 7.1 支出分類

預設分類：

- 房租
- 食物／外食
- 超市
- 油錢
- 車輛維修
- 健身
- 娛樂
- 手機／網路
- 交通
- 其他

分類應可擴充，不要以大量 `if/else` 寫死顯示邏輯。

### 7.2 一般支出欄位

- `id`
- 日期
- 金額
- 分類
- 商家或標題，可選填
- 備註，可選填
- 付款狀態：已支付、預計支付
- 建立時間及更新時間

### 7.3 房租設定

房租需支援：

- 每週
- 每兩週
- 每月
- 自訂週期

系統需區分：

1. 現金流支出：本週實際支付多少。
2. 平均生活成本：依週期換算後，本週應分攤多少。

例如一次支付兩週房租 $360：

```text
本週現金流支出：$360
平均每週房租成本：$180
```

首頁預設的「實際 Weekly Saving」使用本週實際支付金額；分析頁可另外呈現平均成本視角。

### 7.4 支出驗收

- 新增、編輯及刪除支出後，所有摘要應立即更新。
- 刪除前必須要求確認。
- 金額不可為負數或非數字。
- 預計支付的支出不得混入已支付現金流，除非顯示於預估值。

## 8. 功能 C：Weekly Saving 首頁

### 8.1 週期

- 預設一週為星期一至星期日。
- 週起始日應集中設定，避免每個元件各自計算。
- 可切換上一週、下一週及本週。

### 8.2 首頁摘要

至少顯示：

```text
本週實際 Saving
$849

工作收入       $1,200
已收車資          $64
已付房租         -$180
生活支出         -$235

待收車資           $16
預估 Saving        $865
```

另外顯示：

- 本週指定工作日數。
- 本月累計 Saving。
- 可點擊每個摘要進入對應明細。

### 8.3 計算要求

- 所有摘要必須由單一 domain/service 計算，避免各頁面出現不同答案。
- 已收與待收、已付與預計支付必須分開。
- 沒有資料時顯示 `$0.00` 與清楚的空狀態，不得顯示 `NaN`、`undefined`。
- 金額格式預設使用 AUD，並保留未來多幣別擴充能力。

## 9. 功能 D：指定工作日紀錄

### 9.1 功能定位

此功能只協助整理工作紀錄，不應自動宣稱使用者已符合特定簽證資格。

畫面需顯示聲明：

> 此功能僅協助整理工作紀錄。簽證資格及計算方式請以澳洲內政部最新規定為準。

### 9.2 工作紀錄欄位

- 日期
- 是否上班
- 是否標記為指定工作紀錄
- 雇主名稱，可選填
- 工作地點或郵遞區號，可選填
- 工作類型，可選填
- 開始與結束時間，可選填
- 工時
- Payslip 編號或備註，可選填
- 未來可擴充附件，不在本階段實作檔案上傳

### 9.3 統計

- 已記錄指定工作日總數。
- 本週及本月新增數量。
- 依雇主或地點篩選。
- 可讓使用者自行設定追蹤目標，但目標不可包裝成法律判定。

### 9.4 與既有月曆整合

- 沿用既有薪資月曆的工作日期資料，避免使用者輸入兩次。
- 在日期上使用簡短狀態或圖示，不要塞入過多文字。
- 點擊日期後，以 bottom sheet／popup 顯示完整收入、車資、支出及指定工作資訊。

## 10. UI／UX 規格

### 10.1 核心原則

- 直覺性優先於裝飾。
- 每個頁面只突出一個主要操作。
- 常用操作應在三步內完成。
- 使用 progressive disclosure：摘要先顯示，詳細內容點擊後展開。
- 優先使用既有 Vant 元件及其互動模式，不自行重造常見控制項。

### 10.2 色彩語意

- 藍色：主要操作及選取狀態。
- 綠色：已收到的收入。
- 紅色：已發生的支出。
- 橘色：待收款、待付款或提醒。
- 灰色：次要文字及停用狀態。

不可只用顏色表達狀態，需搭配文字或圖示，例如 `✓ 已收`、`○ 待收`。

### 10.3 Design tokens

請在符合現有專案架構的位置集中定義，而非散落 magic numbers：

```css
--font-title: 28px;
--font-heading: 20px;
--font-body: 16px;
--font-caption: 13px;

--space-1: 8px;
--space-2: 16px;
--space-3: 24px;
--space-4: 32px;

--radius-small: 8px;
--radius-medium: 12px;
--radius-large: 16px;
```

若現有專案已有 tokens 或主題系統，應整合而非建立第二套。

### 10.4 月曆簡化

月曆格子不可同時塞入完整薪資、車資、支出及多行備註。每格只顯示日期和最多一至兩個摘要，例如：

```text
8
+$231
```

或：

```text
8
● 工作
```

詳細內容在點擊日期後顯示。

### 10.5 手機可用性

- 重要按鈕需有足夠觸控區域。
- 不得出現非必要的水平捲動。
- 軟體鍵盤不可遮住儲存按鈕。
- 支援 safe area，避免內容被狀態列或底部手勢區遮住。
- 在 Samsung Z Flip 展開螢幕及一般手機寬度測試。
- 保留未來小尺寸 Cover Screen 精簡頁面的可能性，但本階段不實作原生 Widget。

## 11. 建議前端領域模型

以下僅為概念，實際命名需配合現有專案：

```ts
type MoneyCents = number;

interface Passenger {
  id: string;
  name: string;
  active: boolean;
  defaultOneWayFareCents?: MoneyCents;
  defaultRoundTripFareCents?: MoneyCents;
}

interface TripPassengerCharge {
  passengerId: string;
  amountCents: MoneyCents;
  paymentStatus: 'PENDING' | 'PAID';
  paidAt?: string;
}

interface TripRecord {
  id: string;
  date: string;
  type: 'WORK' | 'LEISURE' | 'OTHER';
  tripMode: 'ONE_WAY' | 'ROUND_TRIP' | 'CUSTOM';
  charges: TripPassengerCharge[];
  note?: string;
}

interface ExpenseRecord {
  id: string;
  date: string;
  categoryId: string;
  amountCents: MoneyCents;
  status: 'PAID' | 'PLANNED';
  title?: string;
  note?: string;
}

interface DesignatedWorkRecord {
  date: string;
  worked: boolean;
  markedAsDesignatedWork: boolean;
  employer?: string;
  locationOrPostcode?: string;
  workType?: string;
  startTime?: string;
  endTime?: string;
  hours?: number;
  payslipReference?: string;
  note?: string;
}
```

請先檢查現有型別與資料模型，避免建立重複概念。

## 12. 資料存取架構

UI 不應直接依賴資料存放位置。請建立或沿用 repository interface，例如：

```ts
interface TripRepository {
  listByDateRange(start: string, end: string): Promise<TripRecord[]>;
  save(record: TripRecord): Promise<void>;
  remove(id: string): Promise<void>;
}
```

其他支出、乘客及工作紀錄採相同概念。

現階段後端不存在時：

- 可建立 in-memory/mock implementation 供畫面和測試使用。
- UI 必須明確標示資料可能不會永久保存。
- 不得偷偷使用 `localStorage` 作為正式解法。
- 未來 Spring Boot API 上線後，應能替換 repository implementation，而不需重寫 Vue 頁面及計算邏輯。

## 13. 建議開發階段

### Phase 0：專案審查

- 檢查路由、狀態管理、型別、測試、Vant、Capacitor 和既有薪資計算。
- 執行現有 test、lint、type check 及 production build。
- 提出將新功能整合至現有架構的簡短方案。

### Phase 1：共用基礎

- Money/date utilities。
- Repository interfaces。
- Design tokens。
- 手機版導覽與快速新增入口。
- 不更動既有薪資規則。

### Phase 2：車資 MVP

- 乘客名單。
- 新增、編輯、刪除行程。
- 多選乘客。
- 已收／待收。
- 本週車資統計。

### Phase 3：支出與房租

- 支出 CRUD。
- 分類。
- 房租週期與實付／平均成本。

### Phase 4：Weekly Saving

- 實際與預估 Saving。
- 本週切換及明細連結。
- 空狀態和錯誤狀態。

### Phase 5：指定工作紀錄

- 與既有月曆整合。
- 統計、篩選與免責聲明。

### Phase 6：實機與回歸驗證

- Android Capacitor build/sync。
- Samsung Z Flip 實機畫面檢查。
- iOS safe area 及 Capacitor 相容性檢查；若尚未建立 iOS 平台，不在本任務自行新增。

每個 Phase 完成後先回報變更與驗證結果。若前一階段有阻塞，不要直接跳過並大量修改後續功能。

## 14. 測試要求

至少覆蓋：

- 金額 cents 與格式化。
- 一週日期邊界。
- 已收／待收車資計算。
- 已付／預計支出計算。
- 實際與預估 Weekly Saving。
- 編輯或刪除紀錄後重新計算。
- 空資料狀態。
- 月份及年份切換。
- 跨月的一週統計。

若專案目前沒有測試框架，先回報並提出最小導入方案，不要自行加入大型或重複的工具鏈。

## 15. 非本次範圍

- Spring Boot 實作。
- PostgreSQL schema 與 migration。
- 使用者登入。
- 雲端部署。
- 多使用者共享帳本。
- 正式簽證資格判定。
- Payslip OCR。
- Android/iOS 原生 Widget。
- Google Play 或 App Store 正式上架。
- 付款或銀行帳戶串接。

## 16. 完成條件

- 既有薪資與排班功能無回歸錯誤。
- 車資、支出、Weekly Saving 與指定工作紀錄依規格運作。
- 實際與預估金額明確分開。
- 所有重要計算具備測試。
- production build 成功。
- Capacitor Android sync 成功。
- 手機版沒有明顯水平溢出、按鈕遮擋或鍵盤遮住主要操作。
- 資料未永久保存時，畫面及完成報告清楚說明。

## 17. Codex 完成後回報格式

請回報：

1. 專案原始架構與發現。
2. 實作了哪些 Phase。
3. 修改及新增的檔案。
4. 新增的資料模型與計算規則。
5. 執行的測試、lint、type check、build、Capacitor sync 及結果。
6. 尚未完成的項目與原因。
7. 資料目前是否永久保存。
8. 建議下一個最小開發步驟。

## 18. 給 Codex 的執行指令

```text
請先完整閱讀 EXPENSE_TRACKER_CORE_FEATURES.md 與現有專案。

先執行 Phase 0，回報現有架構、可重用部分、風險與分階段修改計畫。
確認沒有阻塞後，再依文件順序實作。

保留既有薪資計算及 Capacitor Android 功能；不要重寫 Vue，不要將 localStorage 當正式資料庫，也不要擅自新增 Spring Boot、登入或雲端部署。

每完成一個 Phase，都要執行相關測試與 production build。最後依文件第 17 節格式回報。
```

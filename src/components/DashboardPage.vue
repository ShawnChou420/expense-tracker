<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { showToast } from 'vant'
import { formatLocalDate, parseLocalDate } from '../domain/date.js'
import {
  getActualTransactions,
  getDashboardRange,
  getDashboardSummary,
  getDesignatedWorkProgress,
  getPreferredIncomeMode,
  getSavingProgress,
  validateSavingGoal,
} from '../domain/dashboard.js'
import {
  dollarsToCents,
  formatAud,
  formatCentsInput,
  signedDollarsToCents,
} from '../domain/money.js'
import { dashboardSettingsRepository } from '../repositories/inMemoryDashboardSettingsRepository.js'
import {
  expenseRepository,
  subscribeToLedgerChanges,
  tripRepository,
} from '../repositories/appRepositories.js'
const IncomeTrendChart = defineAsyncComponent(() => import('./IncomeTrendChart.vue'))
const ExpenseDonutChart = defineAsyncComponent(() => import('./ExpenseDonutChart.vue'))

const props = defineProps({ workRecords: { type: Array, required: true }, active: Boolean })
const emit = defineEmits(['mark-work-date', 'navigate'])

const today = formatLocalDate(new Date())
const period = ref('week')
const anchor = ref(today)
const trips = ref([])
const expenses = ref([])
const savingGoal = ref(null)
const workDayTarget = ref(null)
const incomeMode = ref('actual')
const selectedIncomePoint = ref(null)
const selectedExpenseGroup = ref(null)
const showGoalForm = ref(false)
const showTargetForm = ref(false)
const workDetailsOpen = ref([])
const incomeDetailsOpen = ref([])
const goalForm = ref({ name: '', target: '', initial: '0.00', startDate: today, endDate: '' })
const targetForm = ref('')

const range = computed(() => getDashboardRange(anchor.value, period.value))
const currentRange = computed(() => getDashboardRange(today, period.value))
const isCurrentPeriod = computed(() => range.value?.start === currentRange.value?.start)
const summary = computed(() =>
  getDashboardSummary({
    range: range.value,
    workRecords: props.workRecords,
    trips: trips.value,
    expenses: expenses.value,
  }),
)
const transactions = computed(() =>
  getActualTransactions({ trips: trips.value, expenses: expenses.value }),
)
const saving = computed(() => getSavingProgress(savingGoal.value, transactions.value, today))
const workProgress = computed(() =>
  getDesignatedWorkProgress(props.workRecords, workDayTarget.value),
)
const eligibleDates = computed(() =>
  [
    ...new Set(
      props.workRecords
        .filter((record) => record.shiftType !== 'leave' && record.paidMinutes > 0)
        .map((record) => record.workDate),
    ),
  ].sort((a, b) => b.localeCompare(a)),
)

function movePeriod(direction) {
  const date = parseLocalDate(anchor.value)
  if (period.value === 'week') date.setDate(date.getDate() + direction * 7)
  else date.setMonth(date.getMonth() + direction, 1)
  anchor.value = formatLocalDate(date)
}

function setPeriod(value) {
  period.value = value
  anchor.value = today
}

async function refreshLedger() {
  const [nextTrips, nextExpenses] = await Promise.all([
    tripRepository.list(),
    expenseRepository.list(),
  ])
  trips.value = nextTrips
  expenses.value = nextExpenses
}

let unsubscribe = null
onMounted(async () => {
  unsubscribe = subscribeToLedgerChanges(refreshLedger)
  await refreshLedger()
  savingGoal.value = await dashboardSettingsRepository.getSavingGoal()
  workDayTarget.value = await dashboardSettingsRepository.getWorkDayTarget()
})
onUnmounted(() => unsubscribe?.())

watch(
  () => [
    range.value?.start,
    summary.value.hasActualIncomeInRange,
    summary.value.hasEstimatedWorkInRange,
    summary.value.hasActualIncomeRecords,
    summary.value.hasEstimatedWorkRecords,
  ],
  () => {
    incomeMode.value = getPreferredIncomeMode(summary.value) || 'actual'
  },
  { immediate: true },
)
watch([period, anchor, incomeMode, summary], () => {
  selectedIncomePoint.value = null
  selectedExpenseGroup.value = null
})

function openGoalEditor() {
  goalForm.value = savingGoal.value
    ? {
        name: savingGoal.value.name,
        target: formatCentsInput(savingGoal.value.targetCents),
        initial: formatCentsInput(savingGoal.value.initialCents),
        startDate: savingGoal.value.startDate,
        endDate: savingGoal.value.endDate || '',
      }
    : { name: '', target: '', initial: '0.00', startDate: today, endDate: '' }
  showGoalForm.value = true
}

async function saveGoal() {
  try {
    const goal = validateSavingGoal({
      name: goalForm.value.name,
      targetCents: dollarsToCents(goalForm.value.target),
      initialCents: signedDollarsToCents(goalForm.value.initial),
      startDate: goalForm.value.startDate,
      endDate: goalForm.value.endDate || null,
    })
    savingGoal.value = await dashboardSettingsRepository.saveSavingGoal(goal)
    showGoalForm.value = false
    showToast('目標已儲存（僅暫存）')
  } catch (error) {
    showToast(error.message)
  }
}

function openTargetEditor() {
  targetForm.value = workDayTarget.value === null ? '' : String(workDayTarget.value)
  showTargetForm.value = true
}

async function saveTarget() {
  const value = Number(targetForm.value)
  if (!Number.isSafeInteger(value) || value <= 0) {
    showToast('請輸入大於 0 的追蹤日數')
    return
  }
  workDayTarget.value = await dashboardSettingsRepository.saveWorkDayTarget(value)
  showTargetForm.value = false
  showToast('追蹤目標已儲存（僅暫存）')
}
</script>

<template>
  <main class="dashboard-page app-page">
    <header class="app-page__header">
      <div>
        <h1>首頁</h1>
        <p>收支、目標與工作紀錄</p>
      </div>
      <van-button plain type="primary" size="small" @click="emit('navigate', 'payroll')"
        >查看班表</van-button
      >
    </header>
    <p class="preview-note">
      開發預覽 · 資料只暫存在記憶體，關閉或重新啟動 App 後會消失；目前沒有會員登入。
    </p>

    <section class="period-card app-page__card" aria-label="日期篩選">
      <div class="period-modes">
        <button type="button" :class="{ selected: period === 'week' }" @click="setPeriod('week')">
          本週
        </button>
        <button type="button" :class="{ selected: period === 'month' }" @click="setPeriod('month')">
          本月
        </button>
      </div>
      <div class="period-nav">
        <button type="button" aria-label="上一期" @click="movePeriod(-1)">
          <van-icon name="arrow-left" />
        </button>
        <strong>{{ range?.start }} – {{ range?.end }}</strong>
        <button type="button" aria-label="下一期" @click="movePeriod(1)">
          <van-icon name="arrow" />
        </button>
      </div>
      <button v-if="!isCurrentPeriod" class="return-current" type="button" @click="anchor = today">
        返回本期
      </button>
    </section>

    <section class="summary-grid" aria-label="所選期間收支摘要">
      <div class="summary-tile app-page__card">
        <span>已記錄收入</span
        ><strong>{{
          summary.hasActualIncomeRecords ? formatAud(summary.actualIncomeCents) : '尚無入帳紀錄'
        }}</strong
        ><small>{{
          summary.salaryDepositConfigured ? '已入帳薪資與已收車資' : '已收車資；實際薪資尚未設定'
        }}</small>
      </div>
      <div class="summary-tile app-page__card">
        <span>已支付支出</span><strong>{{ formatAud(summary.paidExpenseCents) }}</strong
        ><small>房租及生活支出，未付不計入</small>
      </div>
      <div class="summary-tile summary-tile--net app-page__card">
        <span>已記錄淨結餘</span
        ><strong>{{
          summary.hasActualTransactions ? formatAud(summary.netCents) : '尚無實際收支'
        }}</strong
        ><small>{{
          summary.salaryDepositConfigured
            ? '僅包含已提供的收支紀錄'
            : '僅已記錄資料，不含未設定的薪資入帳'
        }}</small>
      </div>
    </section>
    <p class="source-note">
      {{
        summary.salaryDepositConfigured
          ? '僅彙總已提供的入帳紀錄；'
          : '實際薪資入帳尚未設定；上述收入與淨額並非完整帳戶餘額。'
      }}所選行程仍有 {{ formatAud(summary.pendingFareCents) }} 待收，未計入已收收入。
    </p>

    <section class="dashboard-section saving-card app-page__card" aria-labelledby="saving-title">
      <div class="section-head">
        <h2 id="saving-title">Saving 目標</h2>
        <van-button size="small" plain type="primary" @click="openGoalEditor">{{
          savingGoal ? '編輯目標' : '設定目標'
        }}</van-button>
      </div>
      <template v-if="savingGoal">
        <p class="scope-note">
          {{ savingGoal.name }} · {{ savingGoal.startDate }} 起累計{{
            savingGoal.endDate ? ` · 期限 ${savingGoal.endDate}` : ''
          }}；不隨上方篩選重設
        </p>
        <div class="goal-values">
          <span
            >目前累積 <strong>{{ formatAud(saving.currentCents) }}</strong></span
          ><span
            >目標 <strong>{{ formatAud(savingGoal.targetCents) }}</strong></span
          >
        </div>
        <van-progress
          :percentage="saving.progressPercent"
          :show-pivot="false"
          color="#1989fa"
          track-color="#e6edf5"
        />
        <p class="goal-result">
          {{
            saving.excessCents > 0
              ? `已達標，超出 ${formatAud(saving.excessCents)}`
              : `尚差 ${formatAud(saving.remainingCents)}`
          }}
          · {{ saving.percent }}%
        </p>
        <p class="scope-note">
          起始存款 {{ formatAud(savingGoal.initialCents) }} ＋ 已收車資
          {{ formatAud(saving.actualIncomeCents) }} − 已付支出
          {{ formatAud(saving.paidExpenseCents) }}
        </p>
        <p class="data-limit">
          {{
            saving.hasActualTransactions
              ? '薪資入帳未設定，目前累積仍可能不完整。'
              : '尚無目標期間的實際收支；目前只反映起始存款，不使用預估薪資。'
          }}
        </p>
      </template>
      <p v-else class="empty-copy">尚未設定儲蓄目標。開始日之前的餘額可填在「起始存款」。</p>
    </section>

    <div class="analytics-grid">
      <section class="dashboard-section chart-card app-page__card" aria-labelledby="trend-title">
        <div class="section-head"><h2 id="trend-title">收入趨勢</h2></div>
        <div
          v-if="summary.hasActualIncomeRecords || summary.hasEstimatedWorkRecords"
          class="mode-switch"
          aria-label="收入資料口徑"
        >
          <button
            type="button"
            :disabled="!summary.hasActualIncomeRecords"
            :class="{ selected: incomeMode === 'actual' }"
            @click="incomeMode = 'actual'"
          >
            實際入帳
          </button>
          <button
            type="button"
            :disabled="!summary.hasEstimatedWorkRecords"
            :class="{ selected: incomeMode === 'estimated' }"
            @click="incomeMode = 'estimated'"
          >
            預估工作收入
          </button>
        </div>
        <p class="scope-note">
          {{
            incomeMode === 'actual'
              ? summary.salaryDepositConfigured
                ? '按收款日：已收車資與已入帳薪資。'
                : '按收款日：已收車資；實際薪資尚未設定。'
              : '按工作紀錄日期：稅前預估薪資，不代表已入帳。'
          }}
        </p>
        <IncomeTrendChart
          v-if="summary.hasActualIncomeRecords || summary.hasEstimatedWorkRecords"
          :points="summary.days"
          :mode="incomeMode"
          :active="active"
          @select="selectedIncomePoint = $event"
        />
        <p v-else class="empty-copy">尚無可繪製的收入紀錄；預估薪資與實際入帳不會混算。</p>
        <p v-if="selectedIncomePoint" class="chart-selection">
          {{ selectedIncomePoint.date }} ·
          {{
            incomeMode === 'actual'
              ? formatAud(selectedIncomePoint.actualCents)
              : formatAud(selectedIncomePoint.estimatedCents)
          }}（{{
            incomeMode === 'actual'
              ? `已收車資 ${formatAud(selectedIncomePoint.tripCents)}${summary.salaryDepositConfigured ? `、薪資入帳 ${formatAud(selectedIncomePoint.salaryCents)}` : ''}`
              : '工作預估'
          }}）
        </p>
        <van-collapse
          v-if="summary.hasActualIncomeRecords || summary.hasEstimatedWorkRecords"
          v-model="incomeDetailsOpen"
          class="daily-collapse"
        >
          <van-collapse-item name="daily" title="查看每日數值">
            <button
              v-for="point in summary.days"
              :key="point.date"
              type="button"
              class="daily-row"
              @click="selectedIncomePoint = point"
            >
              <span>{{ point.date }}</span>
              <strong>{{
                formatAud(incomeMode === 'actual' ? point.actualCents : point.estimatedCents)
              }}</strong>
            </button>
          </van-collapse-item>
        </van-collapse>
        <p
          v-if="summary.hasActualIncomeRecords || summary.hasEstimatedWorkRecords"
          class="chart-hint"
        >
          點擊折線上的日期可查看金額與來源；無交易日期顯示 0。
        </p>
      </section>

      <section class="dashboard-section chart-card app-page__card" aria-labelledby="expense-title">
        <div class="section-head"><h2 id="expense-title">支出分布</h2></div>
        <p class="scope-note">
          所選期間已支付金額；房租按實付計，不加週平均分攤。現有單次支出以紀錄日期、固定支出以標記已付的該期日期作為付款日。
        </p>
        <ExpenseDonutChart
          v-if="summary.distribution.totalCents > 0"
          :distribution="summary.distribution"
          :active="active"
          @select="selectedExpenseGroup = $event"
        />
        <p v-else class="empty-copy">這段期間尚無已支付支出。</p>
        <p v-if="selectedExpenseGroup" class="chart-selection">
          {{ selectedExpenseGroup.label }} · {{ formatAud(selectedExpenseGroup.amountCents) }}
        </p>
        <div v-if="summary.distribution.detail.length" class="category-list">
          <button
            v-for="entry in summary.distribution.detail"
            :key="entry.id"
            type="button"
            @click="selectedExpenseGroup = entry"
          >
            <span class="category-name"
              ><i :style="{ background: entry.color }"></i>{{ entry.label }}</span
            >
            <span>{{ formatAud(entry.amountCents) }} · {{ entry.percent }}%</span>
          </button>
        </div>
      </section>
    </div>

    <section class="dashboard-section work-card app-page__card" aria-labelledby="work-title">
      <div class="section-head">
        <h2 id="work-title">指定工作紀錄</h2>
        <van-button size="small" plain type="primary" @click="openTargetEditor">{{
          workDayTarget === null ? '設定追蹤目標' : '修改目標'
        }}</van-button>
      </div>
      <p class="scope-note">所有已標記工作紀錄累計，不隨上方期間篩選重設。</p>
      <div class="work-count">
        <strong>{{ workProgress.count }}</strong
        ><span>已標記工作日{{ workDayTarget === null ? '' : `／目標 ${workDayTarget} 日` }}</span>
      </div>
      <template v-if="workDayTarget !== null"
        ><van-progress
          :percentage="workProgress.progressPercent"
          :show-pivot="false"
          color="#1989fa"
          track-color="#e6edf5"
        />
        <p class="goal-result">尚差 {{ workProgress.remaining }} 日</p></template
      >
      <p v-else class="empty-copy">尚未設定追蹤目標，可自行設定，不預設官方門檻。</p>
      <van-collapse v-if="eligibleDates.length" v-model="workDetailsOpen" class="work-collapse"
        ><van-collapse-item name="dates" title="管理工作日標記"
          ><div v-for="date in eligibleDates" :key="date" class="work-date">
            <span>{{ date }}</span
            ><van-switch
              :model-value="workProgress.dates.includes(date)"
              size="22px"
              :aria-label="`${date} 指定工作標記`"
              @update:model-value="emit('mark-work-date', { date, marked: $event })"
            /></div></van-collapse-item
      ></van-collapse>
      <van-button v-else size="small" plain type="primary" @click="emit('navigate', 'payroll')"
        >前往薪資頁新增工作紀錄</van-button
      >
      <p class="disclaimer">此為個人工作紀錄，非官方簽證資格判定。</p>
    </section>

    <van-popup v-model:show="showGoalForm" position="bottom" round safe-area-inset-bottom>
      <form class="edit-sheet" @submit.prevent="saveGoal">
        <h2>儲蓄目標</h2>
        <van-field
          v-model="goalForm.name"
          label="名稱"
          placeholder="例如：旅行基金"
          maxlength="40"
        />
        <van-field v-model="goalForm.target" label="目標 AUD" type="number" placeholder="大於 0" />
        <van-field
          v-model="goalForm.initial"
          label="起始存款 AUD"
          type="number"
          placeholder="可為負數"
        />
        <van-field v-model="goalForm.startDate" label="開始日期" type="date" />
        <van-field v-model="goalForm.endDate" label="截止日期" type="date" />
        <p class="scope-note">起始存款是開始日前的餘額；目標暫存於此 App 執行期間。</p>
        <van-button class="app-page__action" block type="primary" native-type="submit"
          >儲存目標</van-button
        >
      </form>
    </van-popup>
    <van-popup v-model:show="showTargetForm" position="bottom" round safe-area-inset-bottom>
      <form class="edit-sheet" @submit.prevent="saveTarget">
        <h2>追蹤工作日目標</h2>
        <van-field v-model="targetForm" label="目標日數" type="digit" placeholder="自行設定日數" />
        <p class="scope-note">僅供個人追蹤，不代表簽證資格。</p>
        <van-button class="app-page__action" block type="primary" native-type="submit"
          >儲存追蹤目標</van-button
        >
      </form>
    </van-popup>
  </main>
</template>

<style scoped>
.dashboard-page {
  max-width: 820px;
}
.app-page__header :deep(.van-button) {
  min-height: 40px;
  flex: none;
  border-radius: 11px;
}
.preview-note,
.source-note,
.scope-note,
.data-limit,
.chart-hint,
.disclaimer {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}
.preview-note {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #eaf3fe;
}
.source-note {
  margin: 10px 2px 0;
}
.period-card,
.dashboard-section {
  padding: 16px;
}
.period-modes {
  display: flex;
  gap: 7px;
}
.period-modes button,
.mode-switch button {
  min-height: 38px;
  padding: 7px 14px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: #fff;
  color: #345474;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}
.period-modes button.selected,
.mode-switch button.selected {
  border-color: #1989fa;
  background: #eaf3fe;
  color: #166dd1;
}
.period-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 9px;
}
.period-nav button {
  flex: none;
  width: 42px;
  height: 42px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: #f8fafc;
  color: #345474;
}
.period-nav strong {
  text-align: center;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.return-current {
  margin-top: 5px;
  padding: 7px 0;
  border: 0;
  background: none;
  color: #1976d2;
  font-size: 13px;
  font-weight: 700;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: var(--page-section-gap);
}
.summary-tile {
  min-width: 0;
  padding: 14px;
}
.summary-tile span,
.summary-tile small {
  display: block;
  color: var(--color-muted);
  font-size: 12px;
}
.summary-tile strong {
  display: block;
  margin: 5px 0;
  color: #166dd1;
  font-size: clamp(20px, 5.5vw, 27px);
  font-weight: 800;
  overflow-wrap: anywhere;
}
.summary-tile small {
  font-size: 11px;
  line-height: 1.4;
}
.summary-tile--net {
  grid-column: 1 / -1;
  background: #eaf7f0;
}
.summary-tile--net strong {
  color: #167c58;
}
.dashboard-section {
  margin-top: var(--page-section-gap);
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.section-head h2 {
  margin: 0;
  font-size: var(--font-heading);
  font-weight: 800;
}
.section-head :deep(.van-button) {
  flex: none;
  min-height: 38px;
  border-radius: 10px;
}
.scope-note {
  margin: 10px 0;
}
.goal-values {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  margin: 13px 0;
}
.goal-values span {
  display: grid;
  gap: 3px;
  color: var(--color-muted);
  font-size: 12px;
}
.goal-values strong {
  color: #1b2a3b;
  font-size: 18px;
  overflow-wrap: anywhere;
}
.goal-result {
  margin: 9px 0;
  color: #166dd1;
  font-size: 13px;
  font-weight: 700;
}
.data-limit {
  margin: 10px 0 0;
  padding: 9px 10px;
  border-radius: 10px;
  background: #fff7e9;
  color: #976018;
}
.analytics-grid {
  min-width: 0;
}
.mode-switch {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 12px;
}
.mode-switch button:disabled {
  opacity: 0.45;
}
.empty-copy {
  margin: 12px 0 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
}
.chart-selection {
  margin: 10px 0 0;
  padding: 9px 10px;
  border-radius: 10px;
  background: #eaf3fe;
  color: #166dd1;
  font-size: 13px;
  font-weight: 700;
}
.chart-hint {
  margin: 8px 0 0;
}
.daily-collapse {
  margin-top: 10px;
}
.daily-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 42px;
  padding: 9px 0;
  border: 0;
  border-bottom: 1px solid var(--color-border);
  background: none;
  color: #345474;
  font-size: 13px;
  text-align: left;
}
.daily-row:last-child {
  border: 0;
}
.daily-row strong {
  color: #166dd1;
  font-variant-numeric: tabular-nums;
}
.category-list {
  display: grid;
  margin-top: 8px;
}
.category-list button {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 5px 12px;
  min-height: 42px;
  padding: 9px 0;
  border: 0;
  border-bottom: 1px solid var(--color-border);
  background: none;
  color: #345474;
  text-align: left;
  font-size: 13px;
}
.category-list button:last-child {
  border: 0;
}
.category-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.category-name i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.work-count {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 12px 0;
}
.work-count strong {
  color: #166dd1;
  font-size: 30px;
}
.work-count span {
  color: var(--color-muted);
  font-size: 13px;
}
.work-collapse {
  margin-top: 14px;
}
.work-date {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 46px;
  border-bottom: 1px solid var(--color-border);
}
.work-date:last-child {
  border: 0;
}
.disclaimer {
  margin: 12px 0 0;
}
.edit-sheet {
  max-height: min(85dvh, 720px);
  overflow-y: auto;
  padding: 18px 16px 16px;
}
.edit-sheet h2 {
  margin: 0 0 12px;
  font-size: 20px;
}
.edit-sheet :deep(.van-button) {
  position: sticky;
  bottom: 0;
  margin-top: 12px;
}
@media (min-width: 700px) {
  .analytics-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--page-section-gap);
  }
  .summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .summary-tile--net {
    grid-column: auto;
  }
}
</style>

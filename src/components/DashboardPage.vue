<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
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
import { getOnboardingSteps } from '../domain/onboarding.js'
import {
  formatHours,
  formatRangeLabel,
  getEstimatedWeekBalance,
  getPendingFareSummary,
  getTodayShift,
} from '../domain/home.js'
import { getExpenseSummary } from '../domain/expenses.js'
import { getWeekRange } from '../domain/date.js'
import { getIncomeYearProgress } from '../domain/incomeYear.js'
import { getWeeklyPaySummary } from '../domain/weeklyPay.js'
import StatCard from './ui/StatCard.vue'
import ProgressCard from './ui/ProgressCard.vue'
import EmptyState from './ui/EmptyState.vue'
import HeroCard from './ui/HeroCard.vue'
import QuickActions from './ui/QuickActions.vue'
import PeriodSwitcher from './ui/PeriodSwitcher.vue'
import LatestPayslipCard from './LatestPayslipCard.vue'
import { authEmail, authToken } from '../services/authSession.js'
import {
  expenseRepository,
  salaryDepositRepository,
  subscribeToLedgerChanges,
  tripRepository,
} from '../repositories/appRepositories.js'
const IncomeTrendChart = defineAsyncComponent(() => import('./IncomeTrendChart.vue'))
const ExpenseDonutChart = defineAsyncComponent(() => import('./ExpenseDonutChart.vue'))

const props = defineProps({
  workRecords: { type: Array, required: true },
  active: Boolean,
  // 薪資頁的 PPE 與扣稅比率，用來算首頁的「本週預估實領」
  payrollRates: { type: Object, default: () => ({ ppeAllowance: 0, withholdingTaxRate: 0 }) },
  // 最新薪資單上的雇主財年累計（YTD），用來校準年度稅務進度
  employerYtd: { type: Object, default: null },
  // 最近一張已保存的薪資單（會員存在資料庫）
  latestPayslip: { type: Object, default: null },
  // 工作設定完成度：{ payReady, scheduleReady, ready }
  setup: { type: Object, default: () => ({ payReady: false, scheduleReady: false, ready: false }) },
  taxSource: { type: Object, default: null },
})
const emit = defineEmits([
  'mark-work-date',
  'navigate',
  'open-account',
  'quick-action',
  'import-payslip',
  'work-setup',
])

const today = formatLocalDate(new Date())
const period = ref('week')
const anchor = ref(today)
const trips = ref([])
const expenses = ref([])
const salaryDeposits = ref(null)
const sortedSalaryDeposits = computed(() =>
  [...(salaryDeposits.value || [])].sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
)
const hasSalaryDeposits = computed(() => sortedSalaryDeposits.value.length > 0)
// 「開始使用」引導：全部完成後自動隱藏；按 × 只在這次開啟期間隱藏
const onboardingDismissed = ref(false)
const onboarding = computed(() =>
  getOnboardingSteps({
    workRecords: props.workRecords,
    expenses: expenses.value,
    savingGoal: savingGoal.value,
    salaryDeposits: salaryDeposits.value,
    isMember: Boolean(authToken.value),
    workSetupReady: props.setup.ready,
  }),
)
const showSalaryForm = ref(false)
const editingSalaryId = ref(null)
const salaryForm = ref({ paidAt: today, amount: '', gross: '', tax: '', periodStart: '', periodEnd: '' })
const savingGoal = ref(null)
const workDayTarget = ref(null)
const incomeMode = ref('actual')
const selectedIncomePoint = ref(null)
const selectedExpenseGroup = ref(null)
const showGoalForm = ref(false)
const showTargetForm = ref(false)
const workDetailsOpen = ref([])
const incomeDetailsOpen = ref([])
// 進階統計預設收合；展開時才載入圖表
const advancedOpen = ref(false)
const goalForm = ref({ name: '', target: '', initial: '0.00', startDate: today, endDate: '' })
const targetForm = ref('')

const range = computed(() => getDashboardRange(anchor.value, period.value))
const currentRange = computed(() => getDashboardRange(today, period.value))
const isCurrentPeriod = computed(() => range.value?.start === currentRange.value?.start)

// --- 首頁重點：今天、本週、年度稅務、簽證工作日 ---
const weekdayNames = ['日', '一', '二', '三', '四', '五', '六']
const todayLabel = computed(() => {
  const date = parseLocalDate(today)
  return date ? `${today.slice(5).replace('-', '/')}（${weekdayNames[date.getDay()]}）` : today
})
const todayShift = computed(() => getTodayShift(props.workRecords, today))
const weeklyPay = computed(() => getWeeklyPaySummary(props.workRecords, today, props.payrollRates))
const thisWeekSummary = computed(() =>
  getDashboardSummary({
    range: getDashboardRange(today, 'week'),
    workRecords: props.workRecords,
    trips: trips.value,
    expenses: expenses.value,
    salaryDeposits: salaryDeposits.value,
  }),
)
const incomeYearProgress = computed(() =>
  getIncomeYearProgress({
    records: props.workRecords,
    salaryDeposits: salaryDeposits.value,
    employerYtd: props.employerYtd,
    today,
  }),
)
const taxProgressHint = computed(() => {
  const progress = incomeYearProgress.value
  if (!progress) return ''
  if (progress.crossed) return '已超過第一級距，之後稅率較高。'
  if (progress.projectedWithinYear && progress.projectedCrossDate) {
    return `照最近 4 週平均 ${formatAud(progress.recentWeeklyAverageCents)}／週，預計 ${progress.projectedCrossDate} 左右超過。`
  }
  if (progress.recentWeeklyAverageCents > 0) return '照最近 4 週推算，今年不會超過。'
  return '最近 4 週沒有班表，無法預估。'
})
const summary = computed(() =>
  getDashboardSummary({
    range: range.value,
    workRecords: props.workRecords,
    trips: trips.value,
    expenses: expenses.value,
    salaryDeposits: salaryDeposits.value,
  }),
)
const transactions = computed(() =>
  getActualTransactions({ trips: trips.value, expenses: expenses.value, salaryDeposits: salaryDeposits.value }),
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

const weekLabel = computed(() => formatRangeLabel(getWeekRange(today)))
const accountInitial = computed(() =>
  authToken.value && authEmail.value ? authEmail.value.trim().charAt(0).toUpperCase() : '',
)
const weekExpenses = computed(() => getExpenseSummary(expenses.value, getWeekRange(today)))
const weekBalance = computed(() =>
  getEstimatedWeekBalance(weeklyPay.value.netCents, weekExpenses.value),
)
const pendingFares = computed(() => getPendingFareSummary(trips.value))
const heroItems = computed(() => [
  { label: '稅前薪資', value: formatAud(weeklyPay.value.grossCents) },
  { label: '預估預扣', value: formatAud(weeklyPay.value.taxCents) },
])
const heroMeta = computed(() => {
  const flags = weeklyPay.value.rateFlags
  return [
    `已排 ${formatHours(weeklyPay.value.paidMinutes)} · ${weeklyPay.value.shiftCount} 天班表` +
      (weeklyPay.value.ppeCents > 0 ? ' · 含 PPE' : ''),
    flags.provisional.length ? '含未確認費率，僅供參考' : '',
    flags.excluded.length ? `未含${flags.excluded.join('、')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
})
// 首頁主卡的空狀態：還沒設定費率→引導工作設定；設定好但這週沒班→引導排班
const heroEmpty = computed(() => {
  if (!props.setup.payReady && weeklyPay.value.shiftCount === 0) {
    return {
      title: '先完成工作設定',
      description: '設定時薪和班別後，這裡會顯示本週可以拿多少。',
      action: '開始設定',
      icon: 'setting-o',
    }
  }
  if (weeklyPay.value.shiftCount === 0) {
    return props.setup.scheduleReady
      ? {
          title: '這週還沒有班表',
          description: '依你的班別排好這週，確認後才加入。',
          action: '排這週的班',
          icon: 'plus',
        }
      : {
          title: '這週還沒有班表',
          description: '設定班別後可以一鍵排好整週。',
          action: '設定班別',
          icon: 'clock-o',
        }
  }
  return null
})
function onHeroAction() {
  if (!props.setup.payReady) emit('work-setup', 1)
  else if (!props.setup.scheduleReady) emit('work-setup', 2)
  else emit('quick-action', 'fill-week')
}
const quickActions = [
  { key: 'shift', label: '記錄班表', icon: 'calendar-o' },
  { key: 'expense', label: '新增支出', icon: 'records' },
  { key: 'trip', label: '記錄車資', icon: 'logistics' },
]

function formatTodayRange(shift) {
  return `${shift.startTime}–${shift.endTime}${shift.crossesMidnight ? '（隔天）' : ''}`
}

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

function openSalaryEditor(deposit = null) {
  editingSalaryId.value = deposit?.id ?? null
  salaryForm.value = deposit
    ? {
        paidAt: deposit.paidAt,
        amount: formatCentsInput(deposit.amountCents),
        gross: deposit.grossCents == null ? '' : formatCentsInput(deposit.grossCents),
        tax: deposit.taxCents == null ? '' : formatCentsInput(deposit.taxCents),
        periodStart: deposit.periodStart || '',
        periodEnd: deposit.periodEnd || '',
      }
    : { paidAt: today, amount: '', gross: '', tax: '', periodStart: '', periodEnd: '' }
  showSalaryForm.value = true
}

async function saveSalary() {
  const net = dollarsToCents(salaryForm.value.amount)
  const gross = salaryForm.value.gross === '' ? null : dollarsToCents(salaryForm.value.gross)
  const tax = salaryForm.value.tax === '' ? null : dollarsToCents(salaryForm.value.tax)
  if (!parseLocalDate(salaryForm.value.paidAt) || !Number.isSafeInteger(net) || net < 0 ||
      (gross !== null && (!Number.isSafeInteger(gross) || gross < 0)) ||
      (tax !== null && (!Number.isSafeInteger(tax) || tax < 0)) ||
      (salaryForm.value.periodStart && !parseLocalDate(salaryForm.value.periodStart)) ||
      (salaryForm.value.periodEnd && !parseLocalDate(salaryForm.value.periodEnd)) ||
      (salaryForm.value.periodStart && salaryForm.value.periodEnd && salaryForm.value.periodEnd < salaryForm.value.periodStart)) {
    showToast('請檢查入帳日期、金額及薪資期間')
    return
  }
  try {
    await salaryDepositRepository.save({
      id: editingSalaryId.value || crypto.randomUUID(),
      paidAt: salaryForm.value.paidAt,
      amountCents: net,
      grossCents: gross,
      taxCents: tax,
      periodStart: salaryForm.value.periodStart || null,
      periodEnd: salaryForm.value.periodEnd || null,
    })
    showSalaryForm.value = false
    await refreshLedger()
    showToast('薪資入帳已記錄')
  } catch (error) { showToast(error.message) }
}

async function removeSalary(deposit) {
  try {
    await showConfirmDialog({ title: '刪除薪資入帳？', message: `${deposit.paidAt} 的實際入帳紀錄將移除。` })
    await salaryDepositRepository.remove(deposit.id)
    await refreshLedger()
  } catch (error) {
    if (error !== 'cancel') showToast(error.message)
  }
}

async function refreshLedger() {
  const identity = authToken.value
  const [nextTrips, nextExpenses, nextDeposits] = await Promise.all([
    tripRepository.list(),
    expenseRepository.list(),
    salaryDepositRepository.list(),
  ])
  if (identity !== authToken.value) return
  trips.value = nextTrips
  expenses.value = nextExpenses
  salaryDeposits.value = nextDeposits
}
async function refreshDashboardData() {
  const identity = authToken.value
  await refreshLedger()
  const [goal, target] = await Promise.all([
    dashboardSettingsRepository.getSavingGoal(), dashboardSettingsRepository.getWorkDayTarget(),
  ])
  if (identity === authToken.value) {
    savingGoal.value = goal
    workDayTarget.value = target
  }
}

let unsubscribe = null
onMounted(() => {
  unsubscribe = subscribeToLedgerChanges(() => refreshDashboardData().catch((error) => showToast(error.message)))
  refreshDashboardData().catch((error) => showToast(error.message))
})
onUnmounted(() => unsubscribe?.())
watch(authToken, async () => {
  trips.value = []
  expenses.value = []
  salaryDeposits.value = null
  savingGoal.value = null
  workDayTarget.value = null
  try {
    await refreshDashboardData()
  } catch (error) { showToast(error.message) }
})

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

function runOnboardingAction(action) {
  if (action === 'goal') openGoalEditor()
  else if (action === 'salary') openSalaryEditor()
  else if (action === 'work-setup') emit('work-setup')
  else emit('navigate', action)
}

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
    showToast(authToken.value ? '目標已儲存' : '目標已儲存（僅暫存）')
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
  showToast(authToken.value ? '追蹤目標已儲存' : '追蹤目標已儲存（僅暫存）')
}
</script>

<template>
  <main class="dashboard-page app-page">
    <header class="home-header">
      <div class="home-header__titles">
        <span class="home-header__eyebrow">WORK &amp; SAVE</span>
        <h1>我的澳打生活 🇦🇺</h1>
        <p>{{ weekLabel }}</p>
      </div>
      <button
        type="button"
        class="home-header__account"
        :aria-label="authToken ? `帳號：${authEmail}` : '訪客模式，登入或註冊'"
        @click="emit('open-account')"
      >
        <span v-if="accountInitial">{{ accountInitial }}</span>
        <van-icon v-else name="user-o" />
        <i v-if="!authToken" class="home-header__dot" aria-hidden="true"></i>
      </button>
    </header>
    <button v-if="!authToken" type="button" class="guest-banner" @click="emit('open-account')">
      <van-icon name="info-o" aria-hidden="true" />
      <span>訪客模式：資料重新整理後會消失</span>
      <strong>登入保存</strong>
    </button>

    <HeroCard
      label="本週預估實領"
      :amount="formatAud(weeklyPay.netCents)"
      unit="AUD"
      :meta="heroMeta"
      :items="heroItems"
      :empty="heroEmpty !== null"
      :empty-title="heroEmpty?.title"
      :empty-description="heroEmpty?.description"
      :empty-action-label="heroEmpty?.action"
      :empty-action-icon="heroEmpty?.icon"
      @open="emit('navigate', 'payroll')"
      @action="onHeroAction"
    />

    <LatestPayslipCard
      v-if="latestPayslip"
      class="home-block"
      :payslip="latestPayslip"
      :schedule-ready="setup.scheduleReady"
      :is-member="Boolean(authToken)"
      @setup-schedule="emit('work-setup', 2)"
      @open-payroll="emit('navigate', 'payroll')"
      @import-payslip="emit('import-payslip')"
    />

    <button type="button" class="today-strip app-page__card" @click="emit('navigate', 'payroll')">
      <span class="today-strip__icon" aria-hidden="true">
        <van-icon :name="todayShift.status === 'work' ? 'clock-o' : todayShift.status === 'leave' ? 'smile-o' : 'calendar-o'" />
      </span>
      <span class="today-strip__text">
        <small>今天 {{ todayLabel }}</small>
        <strong v-if="todayShift.status === 'work'">{{ formatTodayRange(todayShift) }}</strong>
        <strong v-else-if="todayShift.status === 'leave'">今天休假</strong>
        <strong v-else>今天沒有排班</strong>
      </span>
      <span v-if="todayShift.status === 'work'" class="today-strip__pay">
        <small>預估稅前</small>
        <strong>{{ formatAud(todayShift.grossCents) }}</strong>
      </span>
      <van-icon v-else name="arrow" class="today-strip__arrow" aria-hidden="true" />
    </button>

    <section class="home-stats home-block" aria-label="本週財務摘要">
      <StatCard
        label="本週預估結餘"
        badge="預估"
        :value="formatAud(weekBalance.balanceCents)"
        :hint="`已扣本週支出 ${formatAud(weekBalance.expenseCents)}`"
        :tone="weekBalance.balanceCents < 0 ? 'expense' : 'income'"
        clickable
        @click="emit('navigate', 'expenses')"
      />
      <StatCard
        label="車資待收"
        :value="formatAud(pendingFares.pendingCents)"
        :hint="pendingFares.chargeCount > 0 ? `${pendingFares.chargeCount} 筆待收款` : '目前沒有待收款'"
        :tone="pendingFares.chargeCount > 0 ? 'pending' : 'default'"
        clickable
        @click="emit('navigate', 'trips')"
      />
    </section>

    <QuickActions class="home-block" :actions="quickActions" @select="emit('quick-action', $event)" />

    <button
      v-if="!latestPayslip"
      type="button"
      class="payslip-cta home-block app-page__card"
      @click="emit('import-payslip')"
    >
      <span class="payslip-cta__icon" aria-hidden="true"><van-icon name="description-o" /></span>
      <span class="payslip-cta__text">
        <strong>讓第一張薪資單，幫你開始記帳。</strong>
        <small>自動設定時薪，並記下這期薪水</small>
      </span>
      <van-icon name="arrow" aria-hidden="true" class="payslip-cta__arrow" />
    </button>

    <section
      v-if="!onboarding.allDone && !onboardingDismissed"
      class="onboarding-card app-page__card home-block"
      aria-labelledby="onboarding-title"
    >
      <div class="onboarding-card__head">
        <div>
          <h2 id="onboarding-title">開始使用</h2>
          <p>
            照著做完這 {{ onboarding.total }} 步，首頁就會顯示你的收支與存款進度（已完成
            {{ onboarding.doneCount }}/{{ onboarding.total }}）
          </p>
        </div>
        <button
          class="onboarding-card__close"
          type="button"
          aria-label="暫時隱藏開始使用"
          @click="onboardingDismissed = true"
        >
          <van-icon name="cross" />
        </button>
      </div>
      <ol class="onboarding-steps">
        <li
          v-for="(step, index) in onboarding.steps"
          :key="step.id"
          :class="{ 'onboarding-steps__item--done': step.done }"
          class="onboarding-steps__item"
        >
          <span class="onboarding-steps__mark" aria-hidden="true">
            <van-icon v-if="step.done" name="success" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <div class="onboarding-steps__text">
            <strong>{{ step.title }}</strong>
            <small>{{ step.done ? '✓ 已完成' : step.description }}</small>
          </div>
          <van-button
            v-if="!step.done"
            size="small"
            type="primary"
            plain
            @click="runOnboardingAction(step.action)"
            >{{ step.actionLabel }}</van-button
          >
        </li>
      </ol>
    </section>

    <ProgressCard
      class="home-block"
      title="存款挑戰"
      :subtitle="savingGoal ? `${savingGoal.name} · 依已記錄的實際收支` : ''"
      :current="formatAud(saving?.currentCents ?? 0)"
      :target="savingGoal ? formatAud(savingGoal.targetCents) : ''"
      :percent="saving?.progressPercent ?? 0"
      :foot-left="`已完成 ${saving?.percent ?? 0}%`"
      :foot-right="
        (saving?.excessCents ?? 0) > 0
          ? `超出 ${formatAud(saving?.excessCents ?? 0)} 🎉`
          : `還差 ${formatAud(saving?.remainingCents ?? 0)}`
      "
      tone="income"
    >
      <template #action>
        <button
          v-if="savingGoal"
          type="button"
          class="icon-button"
          aria-label="編輯儲蓄目標"
          @click="openGoalEditor"
        >
          <van-icon name="setting-o" />
        </button>
      </template>
      <template v-if="!savingGoal" #empty>
        <EmptyState
          class="home-card-empty"
          stacked
          icon="gold-coin-o"
          title="設定你的第一個儲蓄目標。"
          description="設定目標金額，之後依收支自動累計。"
          action-label="建立目標"
          @action="openGoalEditor"
        />
      </template>
      <p v-if="savingGoal && saving && !saving.hasActualTransactions" class="home-card-note">
        還沒有收支紀錄。
      </p>
    </ProgressCard>

    <ProgressCard
      class="home-block"
      title="集簽進度"
      subtitle="指定工作紀錄 · 個人追蹤，非官方資格判定"
      :current="`${workProgress.count} 天`"
      :target="workProgress.target === null ? '' : `${workProgress.target} 天`"
      :percent="workProgress.progressPercent ?? 0"
      :foot-left="`已記錄 ${Math.round(workProgress.progressPercent ?? 0)}%`"
      :foot-right="workProgress.remaining === 0 ? '已達到你的目標 🎉' : `還差 ${workProgress.remaining} 天`"
      tone="primary"
    >
      <template #action>
        <button
          v-if="workProgress.target !== null"
          type="button"
          class="icon-button"
          aria-label="調整追蹤目標"
          @click="openTargetEditor"
        >
          <van-icon name="setting-o" />
        </button>
      </template>
      <template v-if="workProgress.target === null" #empty>
        <EmptyState
          class="home-card-empty"
          stacked
          icon="flag-o"
          :title="workProgress.count > 0 ? `已標記 ${workProgress.count} 天指定工作` : '設定你想追蹤的工作天數'"
          description="設定目標天數，追蹤還差幾天。"
          action-label="設定目標"
          @action="openTargetEditor"
        />
      </template>
    </ProgressCard>

    <ProgressCard
      v-if="incomeYearProgress"
      class="home-block"
      title="年度稅務追蹤"
      :badge="{ payslip: '薪資單 YTD', actual: '實際入帳', estimated: '預估' }[incomeYearProgress.basis]"
      :subtitle="`${incomeYearProgress.incomeYear.label} 財年 · 稅前收入累計`"
      :current="formatAud(incomeYearProgress.ytdGrossCents)"
      :target="formatAud(incomeYearProgress.limitCents)"
      :percent="incomeYearProgress.percent"
      :foot-left="`已達 ${Math.round(incomeYearProgress.percent)}%`"
      :foot-right="
        incomeYearProgress.crossed
          ? '已超過第一級距'
          : `距第一級距上限 ${formatAud(incomeYearProgress.remainingCents)}`
      "
      :tone="incomeYearProgress.percent >= 85 ? 'warning' : 'primary'"
    >
      <p class="home-card-note">{{ taxProgressHint }}</p>
      <p class="home-card-fine">
        {{
          {
            payslip: `依 ${employerYtd?.payDate ?? ''} 依薪資單的年度累計。`,
            actual: '依已記錄的薪資入帳稅前金額。',
            estimated: '依班表預估，匯入薪資單後會更準。',
          }[incomeYearProgress.basis]
        }}個人估算，以 ATO 為準。
      </p>
    </ProgressCard>

    <section class="advanced home-block" aria-labelledby="advanced-title">
      <button
        type="button"
        class="advanced__toggle app-page__card"
        :aria-expanded="advancedOpen"
        aria-controls="advanced-panel"
        @click="advancedOpen = !advancedOpen"
      >
        <span class="advanced__text">
          <strong id="advanced-title">進階統計</strong>
          <small>收入趨勢、支出分布、工作紀錄{{ authToken ? '、薪資入帳' : '' }}</small>
        </span>
        <van-icon :name="advancedOpen ? 'arrow-up' : 'arrow-down'" aria-hidden="true" />
      </button>
      <div v-if="advancedOpen" id="advanced-panel" class="advanced__panel">
      <PeriodSwitcher
        class="home-period"
        :period="period"
        :range-label="`${range?.start ?? ''} – ${range?.end ?? ''}`"
        :is-current="isCurrentPeriod"
        @update:period="setPeriod"
        @move="movePeriod"
        @reset="anchor = today"
      />

      <section class="summary-grid" aria-label="所選期間收支摘要">
        <div class="summary-tile app-page__card">
          <span>已記錄收入</span
          ><strong>{{
            summary.hasActualIncomeInRange ? formatAud(summary.actualIncomeCents) : '本期尚無入帳'
          }}</strong
          ><small>依實際收款日期，不含預估薪資</small>
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
          ><small>僅計入已記錄的收支，不代表帳戶餘額</small>
        </div>
      </section>
      <p class="source-note">
        {{
          hasSalaryDeposits
            ? '薪資依入帳日計算。'
            : authToken
              ? '還沒有記錄薪資入帳。'
              : '訪客模式尚無實際薪資入帳資料。'
        }}{{ summary.pendingFareCents > 0 ? `另有 ${formatAud(summary.pendingFareCents)} 車資待收，未計入收入。` : '' }}
      </p>

      <section v-if="authToken" class="dashboard-section salary-card app-page__card" aria-label="薪資入帳紀錄">
        <div class="section-head salary-card__head">
          <div>
            <h2>薪資入帳</h2>
            <p>實際收到的稅後薪資，依入帳日期統計</p>
          </div>
          <van-button size="small" plain type="primary" icon="plus" @click="openSalaryEditor()">新增入帳</van-button>
        </div>
        <p v-if="salaryDeposits === null" class="salary-card__state">正在讀取入帳紀錄…</p>
        <div v-else-if="!hasSalaryDeposits" class="salary-card__empty">
          <span class="salary-card__empty-icon" aria-hidden="true"><van-icon name="balance-pay" /></span>
          <div>
            <strong>還沒有實際薪資紀錄</strong>
            <p>收到薪水後在這裡記一筆。</p>
          </div>
        </div>
        <div v-else class="salary-list">
          <article v-for="deposit in sortedSalaryDeposits" :key="deposit.id" class="salary-entry">
            <div class="salary-entry__main">
              <div class="salary-entry__when">
                <strong>{{ deposit.paidAt }}</strong>
                <small v-if="deposit.periodStart || deposit.periodEnd">
                  薪資期間 {{ deposit.periodStart || '未填起日' }} ～ {{ deposit.periodEnd || '未填迄日' }}
                </small>
              </div>
              <div class="salary-entry__amount"><small>稅後入帳</small><strong>{{ formatAud(deposit.amountCents) }}</strong></div>
            </div>
            <p v-if="deposit.grossCents != null || deposit.taxCents != null" class="salary-entry__extra">
              <span v-if="deposit.grossCents != null">稅前 {{ formatAud(deposit.grossCents) }}</span>
              <span v-if="deposit.taxCents != null">扣稅 {{ formatAud(deposit.taxCents) }}</span>
            </p>
            <div class="salary-entry__actions">
              <van-button size="small" plain type="primary" @click="openSalaryEditor(deposit)">編輯</van-button>
              <van-button size="small" plain type="danger" @click="removeSalary(deposit)">刪除</van-button>
            </div>
          </article>
        </div>
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
                ? hasSalaryDeposits
                  ? '依收款日：車資與薪資入帳。'
                  : '依收款日：車資（尚未記錄薪資）。'
                : '依工作日：稅前預估，非實際入帳。'
            }}
          </p>
          <IncomeTrendChart
            v-if="summary.hasActualIncomeRecords || summary.hasEstimatedWorkRecords"
            :points="summary.days"
            :mode="incomeMode"
            :active="active"
            @select="selectedIncomePoint = $event"
          />
          <p v-else class="empty-copy">還沒有收入紀錄。</p>
          <p v-if="selectedIncomePoint" class="chart-selection">
            {{ selectedIncomePoint.date }} ·
            {{
              incomeMode === 'actual'
                ? formatAud(selectedIncomePoint.actualCents)
                : formatAud(selectedIncomePoint.estimatedCents)
            }}（{{
              incomeMode === 'actual'
                ? `已收車資 ${formatAud(selectedIncomePoint.tripCents)}${hasSalaryDeposits ? `、薪資入帳 ${formatAud(selectedIncomePoint.salaryCents)}` : ''}`
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
            點折線查看當天金額。
          </p>
        </section>

        <section class="dashboard-section chart-card app-page__card" aria-labelledby="expense-title">
          <div class="section-head"><h2 id="expense-title">支出分布</h2></div>
          <p class="scope-note">
            所選期間已付的支出。
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
        <p class="scope-note">累計所有已標記的工作日。</p>
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
        <p v-else class="empty-copy">還沒設定目標。</p>
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
        <p class="disclaimer">個人紀錄，非官方資格判定。</p>
      </section>
      </div>
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
        <p class="scope-note">起始存款是開始日前的餘額；{{ authToken ? '目標會儲存到會員帳號。' : '訪客模式關閉 App 後不保留。' }}</p>
        <van-button class="app-page__action" block type="primary" native-type="submit"
          >儲存目標</van-button
        >
      </form>
    </van-popup>
    <van-popup v-model:show="showSalaryForm" position="bottom" round safe-area-inset-bottom>
      <form class="edit-sheet salary-sheet" @submit.prevent="saveSalary">
        <h2>{{ editingSalaryId ? '編輯薪資入帳' : '新增薪資入帳' }}</h2>
        <p class="scope-note">填銀行實際收到的金額。</p>
        <van-field v-model="salaryForm.paidAt" label="入帳日期" type="date" required />
        <van-field v-model="salaryForm.amount" label="稅後入帳 AUD" type="number" required />
        <van-field v-model="salaryForm.gross" label="稅前 AUD（選填）" type="number" />
        <van-field v-model="salaryForm.tax" label="扣稅 AUD（選填）" type="number" />
        <van-field v-model="salaryForm.periodStart" label="薪資期起日" type="date" />
        <van-field v-model="salaryForm.periodEnd" label="薪資期迄日" type="date" />
        <van-button class="app-page__action" block type="primary" native-type="submit">儲存入帳</van-button>
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
.home-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.home-header__titles {
  min-width: 0;
}
.home-header__eyebrow {
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
}
.home-header h1 {
  margin: 2px 0 0;
  color: var(--color-heading);
  font-size: clamp(22px, 6.6vw, var(--font-title));
  font-weight: 800;
  line-height: 1.2;
}
.home-header p {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 14px;
}
.home-header__account {
  position: relative;
  display: grid;
  flex: none;
  place-items: center;
  width: var(--touch-target);
  height: var(--touch-target);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface);
  color: var(--color-primary);
  font: inherit;
  font-size: 17px;
  font-weight: 800;
  cursor: pointer;
}
.home-header__dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--color-surface);
  border-radius: 50%;
  background: var(--color-pending-bar);
}
.guest-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--touch-target);
  margin: 0 0 14px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--radius-medium);
  background: var(--color-pending-soft);
  color: var(--color-pending);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.guest-banner span {
  flex: 1;
  min-width: 0;
}
.guest-banner strong {
  flex: none;
  font-weight: 800;
}
.home-block {
  margin-top: 14px;
}
.today-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  margin: 10px 0 0;
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.today-strip__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 19px;
}
.today-strip__text,
.today-strip__pay {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.today-strip__text {
  flex: 1;
}
.today-strip small {
  color: var(--color-muted);
  font-size: 12px;
}
.today-strip strong {
  color: var(--color-heading);
  font-size: 15px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.today-strip__pay {
  text-align: right;
}
.today-strip__pay strong {
  color: var(--color-primary);
}
.today-strip__arrow {
  flex: none;
  color: #9aa8b8;
}
.home-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.payslip-cta {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border: 1px solid var(--color-primary);
  background: var(--color-primary-soft);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.payslip-cta__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: 21px;
}
.payslip-cta__text {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}
.payslip-cta__text strong {
  color: var(--color-heading);
  font-size: 15px;
  font-weight: 800;
}
.payslip-cta__text small {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}
.payslip-cta__arrow {
  flex: none;
  color: var(--color-primary);
}
.icon-button {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--touch-target);
  height: var(--touch-target);
  margin: -10px -10px 0 0;
  border: 0;
  border-radius: 12px;
  background: none;
  color: var(--color-muted);
  font-size: 19px;
  cursor: pointer;
}
.home-card-empty {
  margin-top: 12px;
}
.home-card-note {
  margin: 10px 0 0;
  color: var(--color-heading);
  font-size: 13px;
  line-height: 1.5;
}
.home-card-fine {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.5;
}
.advanced__toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  color: var(--color-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.advanced__text {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}
.advanced__text strong {
  color: var(--color-heading);
  font-size: 16px;
  font-weight: 800;
}
.advanced__text small {
  font-size: 12px;
}
.advanced__panel {
  animation: advanced-in var(--motion-fast) ease;
}
.advanced__panel > :first-child {
  margin-top: 12px;
}
@keyframes advanced-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
@media (min-width: 720px) {
  .home-stats {
    gap: 14px;
  }
}
.onboarding-card {
  padding: 16px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
}
.onboarding-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.onboarding-card__head h2 {
  margin: 0;
  font-size: var(--font-heading);
  font-weight: 800;
}
.onboarding-card__head p {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
}
.onboarding-card__close {
  display: grid;
  flex: none;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--color-muted);
  font-size: 16px;
}
.onboarding-steps {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.onboarding-steps__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
}
.onboarding-steps__mark {
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 800;
}
.onboarding-steps__text {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}
.onboarding-steps__text strong {
  color: var(--color-heading);
  font-size: 14px;
}
.onboarding-steps__text small {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}
.onboarding-steps__item :deep(.van-button) {
  flex: none;
  min-width: 76px;
}
.onboarding-steps__item--done {
  background: #f7fbf9;
}
.onboarding-steps__item--done .onboarding-steps__mark {
  background: var(--color-income-soft);
  color: var(--color-income);
}
.onboarding-steps__item--done .onboarding-steps__text small {
  color: var(--color-income);
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
.salary-card__head { align-items: flex-start; flex-wrap: wrap; }
.salary-card__head > div { flex: 1; min-width: 150px; }
.salary-card__head p { margin: 4px 0 0; color: var(--color-muted); font-size: 12px; line-height: 1.4; }
.salary-card__state { margin: 18px 0 0; color: var(--color-muted); font-size: 13px; }
.salary-card__empty { display: flex; align-items: center; gap: 12px; margin-top: 16px; padding: 15px; border: 1px dashed #cbdff4; border-radius: 14px; background: #f7fbff; }
.salary-card__empty-icon { display: grid; flex: none; place-items: center; width: 42px; height: 42px; border-radius: 13px; background: #eaf3fe; color: #166dd1; font-size: 22px; }
.salary-card__empty strong { color: var(--color-heading); font-size: 14px; }
.salary-card__empty p { margin: 3px 0 0; color: var(--color-muted); font-size: 12px; line-height: 1.5; }
.salary-list { display: grid; gap: 10px; margin-top: 16px; }
.salary-entry { min-width: 0; padding: 14px; border: 1px solid var(--color-border); border-radius: 15px; background: #f8fbff; }
.salary-entry__main { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: start; }
.salary-entry__when, .salary-entry__amount { display: grid; gap: 4px; min-width: 0; }
.salary-entry__when strong { color: var(--color-heading); font-size: 14px; font-variant-numeric: tabular-nums; }
.salary-entry__when small, .salary-entry__amount small { color: var(--color-muted); font-size: 11px; line-height: 1.4; }
.salary-entry__amount { text-align: right; }
.salary-entry__amount strong { color: var(--color-income); font-size: clamp(18px, 5vw, 23px); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.salary-entry__extra { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 10px 0 0; color: var(--color-muted); font-size: 12px; }
.salary-entry__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--color-border); }
.salary-entry__actions :deep(.van-button) { min-height: 38px; min-width: 62px; border-radius: 10px; }
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
@media (max-width: 340px) {
  .salary-entry__main { grid-template-columns: minmax(0, 1fr); }
  .salary-entry__amount { text-align: left; }
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

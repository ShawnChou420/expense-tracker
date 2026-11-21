<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LanguageSwitcher from './LanguageSwitcher.vue'
import { formatDateRange, formatHoursLabel, formatLongDate, joinList } from '../i18n/format.js'
import { expenseGroupLabel } from '../i18n/labels.js'
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
  formatCentsInput,
  signedDollarsToCents,
} from '../domain/money.js'
import { dashboardSettingsRepository } from '../repositories/inMemoryDashboardSettingsRepository.js'
import { getNextOnboardingStep, getOnboardingSteps } from '../domain/onboarding.js'
import { getVisibleModuleIds, normalizeLayout } from '../domain/dashboardLayout.js'
import DashboardCustomizeSheet from './DashboardCustomizeSheet.vue'
import QuickPayEstimator from './QuickPayEstimator.vue'
import {
  getEstimatedWeekBalance,
  getPendingFareSummary,
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
import VisaJourneyCard from './VisaJourneyCard.vue'
import TodayShiftCard from './TodayShiftCard.vue'
import FuelPriceCard from './FuelPriceCard.vue'
import TodaySection from './TodaySection.vue'
import { getFocusShift, getGreetingKey } from '../domain/today.js'
import { formatCentsIn } from '../domain/displayCurrency.js'
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
  // 集簽設定（null＝尚未設定）與 getVisaJourneyProgress() 的估算結果
  visaJourney: { type: Object, default: null },
  visaProgress: { type: Object, default: null },
  // 顯示幣別（resolveDisplayCurrency 的結果）；金額仍以 AUD 計算，只在顯示時換算
  displayCurrency: { type: Object, default: () => ({ code: 'AUD', rate: 1, flag: '🇦🇺', fallback: false }) },
})
const emit = defineEmits([
  'mark-work-date',
  'navigate',
  'open-account',
  'quick-action',
  'adjust-shift',
  'import-payslip',
  'work-setup',
  'visa-setup',
  'import-history',
  'change-currency',
])
/** AUD cents → 目前顯示幣別的金額文字 */
const money = (/** @type {number} */ cents) => formatCentsIn(cents, props.displayCurrency)

const { t, locale } = useI18n()
const today = formatLocalDate(new Date())
// 「今天」區塊用的即時時間：每分鐘更新，跨午夜時自動換成新的一天
const now = ref(new Date())
const liveToday = computed(() => formatLocalDate(now.value))
let clockTimer = null
const greeting = computed(() =>
  t(`greeting.${getGreetingKey(now.value, getFocusShift(props.workRecords, now.value).kind === 'current')}`),
)
const liveDateLabel = computed(() => {
  void locale.value // 切換語言時重新格式化
  return formatLongDate(now.value)
})
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
const nextOnboardingStep = computed(() => getNextOnboardingStep(onboarding.value))
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
  if (progress.crossed) return t('dashboard.taxCrossed')
  if (progress.projectedWithinYear && progress.projectedCrossDate) {
    return t('dashboard.taxProjected', { amount: money(progress.recentWeeklyAverageCents), date: progress.projectedCrossDate })
  }
  if (progress.recentWeeklyAverageCents > 0) return t('dashboard.taxWithinYear')
  return t('dashboard.taxNoData')
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
// 支出分布圖的分類名稱依目前語系顯示（資料只存 id）
const localizedDistribution = computed(() => {
  void locale.value
  const localize = (entry) => ({ ...entry, label: expenseGroupLabel(entry.id, entry.label) })
  const distribution = summary.value.distribution
  return { ...distribution, chart: distribution.chart.map(localize), detail: distribution.detail.map(localize) }
})
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

const weekLabel = computed(() => {
  void locale.value
  return formatDateRange(getWeekRange(today))
})
const accountInitial = computed(() =>
  authToken.value && authEmail.value ? authEmail.value.trim().charAt(0).toUpperCase() : '',
)
const weekExpenses = computed(() => getExpenseSummary(expenses.value, getWeekRange(today)))
const weekBalance = computed(() =>
  getEstimatedWeekBalance(weeklyPay.value.netCents, weekExpenses.value),
)
const pendingFares = computed(() => getPendingFareSummary(trips.value))
const heroItems = computed(() => [
  { label: t('dashboard.weeklyGross'), value: money(weeklyPay.value.grossCents) },
  { label: t('dashboard.estimatedWithholding'), value: money(weeklyPay.value.taxCents) },
])
const heroMeta = computed(() => {
  const flags = weeklyPay.value.rateFlags
  return [
    // 原本的「本週財務」標題拿掉了，週別改放在這裡
    t('dashboard.weekMeta', { week: weekLabel.value, hours: formatHoursLabel(weeklyPay.value.paidMinutes), days: weeklyPay.value.shiftCount }) +
      (weeklyPay.value.ppeCents > 0 ? ` · ${t('dashboard.includesPpe')}` : ''),
    flags.provisional.length ? t('dashboard.provisionalRates') : '',
    flags.excluded.length ? t('dashboard.excludedRates', { items: joinList(flags.excluded) }) : '',
  ]
    .filter(Boolean)
    .join(' · ')
})
// 首頁主卡的空狀態：還沒設定費率→引導工作設定；設定好但這週沒班→引導排班
const heroEmpty = computed(() => {
  if (!props.setup.payReady && weeklyPay.value.shiftCount === 0) {
    return {
      title: t('dashboard.setupTitle'),
      description: t('dashboard.setupDescription'),
      action: t('dashboard.startSetup'),
      icon: 'setting-o',
    }
  }
  if (weeklyPay.value.shiftCount === 0) {
    return props.setup.scheduleReady
      ? {
          title: t('dashboard.noShiftsTitle'),
          description: t('dashboard.fillWeekDescription'),
          action: t('dashboard.fillWeekAction'),
          icon: 'plus',
        }
      : {
          title: t('dashboard.noShiftsTitle'),
          description: t('dashboard.setShiftsDescription'),
          action: t('dashboard.setShiftsAction'),
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
const quickActions = computed(() => [
  { key: 'shift', label: t('dashboard.addShift'), icon: 'calendar-o' },
  { key: 'expense', label: t('dashboard.addExpense'), icon: 'records' },
  { key: 'trip', label: t('dashboard.addTrip'), icon: 'logistics' },
])

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
    showToast(t('dashboard.salaryCheckInput'))
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
    showToast(t('dashboard.salarySaved'))
  } catch (error) { showToast(error.message) }
}

async function removeSalary(deposit) {
  try {
    await showConfirmDialog({ title: t('dashboard.deleteSalaryTitle'), message: t('dashboard.deleteSalaryMessage', { date: deposit.paidAt }) })
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
  const settings = await dashboardSettingsRepository.getSettings()
  if (identity === authToken.value) {
    savingGoal.value = settings.savingGoal
    workDayTarget.value = settings.workDayTarget
    // 首頁自訂正在儲存時不覆蓋，避免畫面跳回舊設定
    if (!layoutSaving) savedLayout.value = settings.dashboardLayout
  }
}

// --- 首頁自訂（模式、模組顯示與順序）---
const savedLayout = ref(/** @type {unknown} */ (null))
const customizeOpen = ref(false)
let layoutSaving = 0
// 集簽：選了「目前不集簽」才不顯示；還沒設定時仍顯示設定入口
const layoutContext = computed(() => ({ hasVisa: props.visaJourney?.goal !== 'NONE' }))
const layout = computed(() => normalizeLayout(savedLayout.value))
// 全新訪客（沒登入、還沒完成工作設定、也沒有任何班表）：首頁改成雙滑桿快速試算，只留每日小語
// 一旦開始設定或建立班表，就回到一般首頁，顯示自己的資料
const guestWelcome = computed(
  () => !authToken.value && !props.setup.ready && props.workRecords.length === 0,
)
const visibleModuleIds = computed(() =>
  guestWelcome.value ? ['daily-quote'] : getVisibleModuleIds(layout.value, layoutContext.value),
)
const show = (/** @type {string} */ id) => visibleModuleIds.value.includes(id)
// 以 10 為間隔，留位置給固定的提示卡：薪資單入口（5）、下一步（6）固定在第一個區塊之後
const orderStyle = (/** @type {string} */ id) => ({ order: visibleModuleIds.value.indexOf(id) * 10 })
const todayParts = computed(() => {
  const part = (/** @type {string} */ id) => ({ visible: show(id), order: visibleModuleIds.value.indexOf(id) * 10 })
  return { tasks: part('today-tasks'), quote: part('daily-quote'), mood: part('mood-journal') }
})
async function updateLayout(/** @type {import('../domain/dashboardLayout.js').DashboardLayout} */ next) {
  const identity = authToken.value
  const previous = savedLayout.value
  savedLayout.value = next
  layoutSaving += 1
  try {
    await dashboardSettingsRepository.saveDashboardLayout(next)
  } catch (error) {
    // 儲存失敗：回到原本的設定並告知，不假裝已儲存
    if (identity === authToken.value && savedLayout.value === next) savedLayout.value = previous
    showToast(t('dashboard.layoutNotSaved', { reason: error instanceof Error ? error.message : t('dashboard.tryLater') }))
  } finally {
    layoutSaving -= 1
  }
}

let unsubscribe = null
onMounted(() => {
  clockTimer = setInterval(() => (now.value = new Date()), 60_000)
  unsubscribe = subscribeToLedgerChanges(() => refreshDashboardData().catch((error) => showToast(error.message)))
  refreshDashboardData().catch((error) => showToast(error.message))
})
onUnmounted(() => {
  unsubscribe?.()
  clearInterval(clockTimer)
})
watch(authToken, async () => {
  // 換帳號：先清掉上一個帳號的首頁設定，不外洩
  savedLayout.value = null
  customizeOpen.value = false
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
    showToast(authToken.value ? t('dashboard.goalSaved') : t('dashboard.goalSavedTemp'))
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
    showToast(t('dashboard.targetInvalid'))
    return
  }
  workDayTarget.value = await dashboardSettingsRepository.saveWorkDayTarget(value)
  showTargetForm.value = false
  showToast(authToken.value ? t('dashboard.targetSaved') : t('dashboard.targetSavedTemp'))
}
</script>

<template>
  <main class="dashboard-page app-page">
    <header class="home-header">
      <div v-if="guestWelcome" class="home-header__titles">
        <span class="home-header__brand">Expense Tracker</span>
      </div>
      <div v-else class="home-header__titles">
        <span class="home-header__eyebrow">{{ liveDateLabel }}</span>
        <h1>{{ greeting }}</h1>
      </div>
      <button v-if="!guestWelcome" type="button" class="home-header__customize" @click="customizeOpen = true">
        <van-icon name="apps-o" aria-hidden="true" />{{ t('dashboard.customize') }}
      </button>
      <LanguageSwitcher v-if="!authToken" class="home-header__language" />
      <button
        type="button"
        class="home-header__account"
        :aria-label="authToken ? t('dashboard.accountAria', { email: authEmail }) : t('dashboard.guestAccountAria')"
        @click="emit('open-account')"
      >
        <span v-if="accountInitial">{{ accountInitial }}</span>
        <van-icon v-else name="user-o" />
        <i v-if="!authToken" class="home-header__dot" aria-hidden="true"></i>
      </button>
    </header>
    <p v-if="displayCurrency.code !== 'AUD'" class="currency-note">
      {{ t('dashboard.currencyConverted', { currency: displayCurrency.code }) }}
    </p>
    <p v-else-if="displayCurrency.fallback" class="currency-note">
      {{ t('dashboard.currencyFallback', { currency: displayCurrency.requested }) }}
    </p>
    <QuickPayEstimator
      v-if="guestWelcome"
      @start="emit('work-setup', 1)"
      @import-payslip="emit('import-payslip')"
      @open-account="emit('open-account')"
    />
    <button v-if="!authToken && !guestWelcome" type="button" class="guest-banner" @click="emit('open-account')">
      <van-icon name="info-o" aria-hidden="true" />
      <span>{{ t('dashboard.guestBanner') }}</span>
      <strong>{{ t('dashboard.loginToSave') }}</strong>
    </button>

    <!-- 首頁模組：顯示與順序由「自訂首頁」決定（CSS order）；隱藏只影響畫面，不刪除資料 -->
    <div class="home-modules">
    <EmptyState
      v-if="!visibleModuleIds.length"
      class="home-modules__empty"
      icon="apps-o"
      :title="t('dashboard.noWidgets')"
      :action-label="t('dashboard.customize')"
      @action="customizeOpen = true"
    />
    <div v-if="show('today-shift')" class="home-module" :style="orderStyle('today-shift')">
      <TodayShiftCard
        :records="workRecords"
        :now="now"
        :pay-ready="setup.payReady"
        :money="money"
        :currency="displayCurrency.code"
        @open-payroll="emit('navigate', 'payroll')"
        @import-payslip="emit('import-payslip')"
        @work-setup="emit('work-setup', 1)"
        @add-shift="emit('quick-action', 'shift')"
        @adjust-shift="emit('adjust-shift', $event)"
      />

    </div>

    <div v-if="show('fuel-prices')" class="home-module" :style="orderStyle('fuel-prices')">
      <FuelPriceCard :now="now" />
    </div>

    <TodaySection :today="liveToday" :parts="todayParts" />

    <div v-if="show('weekly-pay')" class="home-module" :style="orderStyle('weekly-pay')">
      <HeroCard
        :label="t('dashboard.estimatedWeeklyNet')"
        :amount="money(weeklyPay.netCents)"
        :unit="displayCurrency.code"
        :meta="heroMeta"
        :items="heroItems"
        :empty="heroEmpty !== null"
        :empty-title="heroEmpty?.title"
        :empty-description="heroEmpty?.description"
        :empty-action-label="heroEmpty?.action"
        :empty-action-icon="heroEmpty?.icon"
        @open="emit('navigate', 'payroll')"
        @action="onHeroAction"
      >
        <template #corner>
          <button
            type="button"
            class="hero-currency"
            :aria-label="t('dashboard.currencyAria', { currency: displayCurrency.code })"
            @click="emit('change-currency')"
          >
            {{ displayCurrency.flag }} {{ displayCurrency.code }}
            <van-icon name="arrow-down" aria-hidden="true" />
          </button>
        </template>
      </HeroCard>
    </div>

    <div v-if="show('latest-payslip') && latestPayslip" class="home-module" :style="orderStyle('latest-payslip')">
      <LatestPayslipCard
        :format="money"
        class="home-block"
        :payslip="latestPayslip"
        :schedule-ready="setup.scheduleReady"
        :is-member="Boolean(authToken)"
        @setup-schedule="emit('work-setup', 2)"
        @open-payroll="emit('navigate', 'payroll')"
        @import-payslip="emit('import-payslip')"
      />
    </div>

    <div v-if="show('weekly-balance')" class="home-module" :style="orderStyle('weekly-balance')">
      <StatCard
        :label="t('dashboard.estimatedWeeklyBalance')"
        :badge="t('dashboard.estimate')"
        :value="money(weekBalance.balanceCents)"
        :hint="t('dashboard.expensesDeducted', { amount: money(weekBalance.expenseCents) })"
        :tone="weekBalance.balanceCents < 0 ? 'expense' : 'income'"
        clickable
        @click="emit('navigate', 'expenses')"
      />
    </div>

    <div v-if="show('pending-fares')" class="home-module" :style="orderStyle('pending-fares')">
      <StatCard
        :label="t('dashboard.pendingFares')"
        :value="money(pendingFares.pendingCents)"
        :hint="pendingFares.chargeCount > 0 ? t('dashboard.pendingChargeCount', { count: pendingFares.chargeCount }) : t('dashboard.noPendingCharges')"
        :tone="pendingFares.chargeCount > 0 ? 'pending' : 'default'"
        clickable
        @click="emit('navigate', 'trips')"
      />
    </div>

    <div v-if="show('quick-actions')" class="home-module" :style="orderStyle('quick-actions')">
      <QuickActions class="home-block" :actions="quickActions" @select="emit('quick-action', $event)" />
    </div>

    <button
      v-if="!latestPayslip && !guestWelcome"
      :style="{ order: 5 }"
      type="button"
      class="payslip-cta home-block app-page__card"
      @click="emit('import-payslip')"
    >
      <span class="payslip-cta__icon" aria-hidden="true"><van-icon name="description-o" /></span>
      <span class="payslip-cta__text">
        <strong>{{ t('dashboard.payslipPromptTitle') }}</strong>
        <small>{{ t('dashboard.payslipPromptText') }}</small>
      </span>
      <van-icon name="arrow" aria-hidden="true" class="payslip-cta__arrow" />
    </button>

    <!-- 開始使用：只顯示下一步。工作設定還沒完成時，上方主卡與薪資單入口已經在引導，不再重複 -->
    <section
      v-if="nextOnboardingStep && setup.ready && !onboardingDismissed && !guestWelcome"
      :style="{ order: 6 }"
      class="onboarding-card app-page__card home-block"
      aria-labelledby="onboarding-title"
    >
      <div class="onboarding-card__head">
        <div>
          <h2 id="onboarding-title">{{ t('dashboard.nextStep', { title: t(`onboarding.${nextOnboardingStep.id}.title`) }) }}</h2>
          <p>{{ t(`onboarding.${nextOnboardingStep.id}.description`) }}</p>
        </div>
        <button
          class="onboarding-card__close"
          type="button"
          :aria-label="t('dashboard.hideNextStep')"
          @click="onboardingDismissed = true"
        >
          <van-icon name="cross" />
        </button>
      </div>
      <div class="onboarding-card__foot">
        <span class="onboarding-card__count">{{ t('dashboard.stepsDone', { done: onboarding.doneCount, total: onboarding.total }) }}</span>
        <van-button size="small" type="primary" @click="runOnboardingAction(nextOnboardingStep.action)">
          {{ t(`onboarding.${nextOnboardingStep.id}.action`) }}
        </van-button>
      </div>
    </section>

    <div v-if="show('savings-goal')" class="home-module" :style="orderStyle('savings-goal')">
      <ProgressCard
        class="home-block"
        :title="t('dashboard.savingChallenge')"
        :subtitle="savingGoal ? t('dashboard.savingSubtitle', { name: savingGoal.name }) : ''"
        :current="money(saving?.currentCents ?? 0)"
        :target="savingGoal ? money(savingGoal.targetCents) : ''"
        :percent="saving?.progressPercent ?? 0"
        :foot-left="t('dashboard.percentDone', { percent: saving?.percent ?? 0 })"
        :foot-right="
          (saving?.excessCents ?? 0) > 0
            ? t('dashboard.exceeded', { amount: money(saving?.excessCents ?? 0) })
            : t('dashboard.remaining', { amount: money(saving?.remainingCents ?? 0) })
        "
        tone="income"
      >
        <template #action>
          <button
            v-if="savingGoal"
            type="button"
            class="icon-button"
            :aria-label="t('dashboard.editGoal')"
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
            :title="t('dashboard.firstGoalTitle')"
            :description="t('dashboard.firstGoalDescription')"
            :action-label="t('dashboard.createGoal')"
            @action="openGoalEditor"
          />
        </template>
        <p v-if="savingGoal && saving && !saving.hasActualTransactions" class="home-card-note">
          {{ t('dashboard.noTransactions') }}
        </p>
      </ProgressCard>
    </div>

    <!-- 集簽：只有設定過集簽（且不是「目前不集簽」）才會出現；歷史班表照常保留 -->
    <div v-if="show('visa-progress')" class="home-module" :style="orderStyle('visa-progress')">
      <VisaJourneyCard
        class="home-block"
        :settings="visaJourney"
        :progress="visaProgress"
        @setup="emit('visa-setup')"
        @import-history="emit('import-history')"
      />
    </div>

    <div v-if="show('tax-progress') && incomeYearProgress" class="home-module" :style="orderStyle('tax-progress')">
      <ProgressCard
        class="home-block"
        :title="t('dashboard.taxTracker')"
        :badge="{ payslip: t('dashboard.basisPayslip'), actual: t('dashboard.basisActual'), estimated: t('dashboard.estimate') }[incomeYearProgress.basis]"
        :subtitle="t('dashboard.taxSubtitle', { year: incomeYearProgress.incomeYear.label })"
        :current="money(incomeYearProgress.ytdGrossCents)"
        :target="money(incomeYearProgress.limitCents)"
        :percent="incomeYearProgress.percent"
        :foot-left="t('dashboard.percentReached', { percent: Math.round(incomeYearProgress.percent) })"
        :foot-right="
          incomeYearProgress.crossed
            ? t('dashboard.firstBracketCrossed')
            : t('dashboard.firstBracketRemaining', { amount: money(incomeYearProgress.remainingCents) })
        "
        :tone="incomeYearProgress.percent >= 85 ? 'warning' : 'primary'"
      >
        <p class="home-card-note">{{ taxProgressHint }}</p>
        <p class="home-card-fine">
          {{
            {
              payslip: t('dashboard.basisPayslipNote', { date: employerYtd?.payDate ?? '' }),
              actual: t('dashboard.basisActualNote'),
              estimated: t('dashboard.basisEstimatedNote'),
            }[incomeYearProgress.basis]
          }}{{ t('dashboard.atoNote') }}
        </p>
      </ProgressCard>
    </div>

    <div v-if="show('advanced')" class="home-module" :style="orderStyle('advanced')">
      <section class="advanced home-block" aria-labelledby="advanced-title">
        <button
          type="button"
          class="advanced__toggle app-page__card"
          :aria-expanded="advancedOpen"
          aria-controls="advanced-panel"
          @click="advancedOpen = !advancedOpen"
        >
          <span class="advanced__text">
            <strong id="advanced-title">{{ t('dashboard.advanced') }}</strong>
            <small>{{ authToken ? t('dashboard.advancedSummaryMember') : t('dashboard.advancedSummary') }}</small>
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

        <section class="summary-grid" :aria-label="t('dashboard.periodSummaryAria')">
          <div class="summary-tile app-page__card">
            <span>{{ t('dashboard.recordedIncome') }}</span
            ><strong>{{
              summary.hasActualIncomeInRange ? money(summary.actualIncomeCents) : t('dashboard.noIncomeInPeriod')
            }}</strong
            ><small>{{ t('dashboard.recordedIncomeNote') }}</small>
          </div>
          <div class="summary-tile app-page__card">
            <span>{{ t('dashboard.paidExpenses') }}</span><strong>{{ money(summary.paidExpenseCents) }}</strong
            ><small>{{ t('dashboard.paidExpensesNote') }}</small>
          </div>
          <div class="summary-tile summary-tile--net app-page__card">
            <span>{{ t('dashboard.recordedNet') }}</span
            ><strong>{{
              summary.hasActualTransactions ? money(summary.netCents) : t('dashboard.noActualTransactions')
            }}</strong
            ><small>{{ t('dashboard.recordedNetNote') }}</small>
          </div>
        </section>
        <p class="source-note">
          {{
            hasSalaryDeposits
              ? t('dashboard.salaryByDeposit')
              : authToken
                ? t('dashboard.noSalaryYet')
                : t('dashboard.guestNoSalary')
          }}{{ summary.pendingFareCents > 0 ? t('dashboard.pendingFareNote', { amount: money(summary.pendingFareCents) }) : '' }}
        </p>

        <section v-if="authToken" class="dashboard-section salary-card app-page__card" :aria-label="t('dashboard.salaryRecordsAria')">
          <div class="section-head salary-card__head">
            <div>
              <h2>{{ t('dashboard.salaryDeposits') }}</h2>
              <p>{{ t('dashboard.salaryDepositsHint') }}</p>
            </div>
            <van-button size="small" plain type="primary" icon="plus" @click="openSalaryEditor()">{{ t('dashboard.addDeposit') }}</van-button>
          </div>
          <p v-if="salaryDeposits === null" class="salary-card__state">{{ t('dashboard.loadingDeposits') }}</p>
          <div v-else-if="!hasSalaryDeposits" class="salary-card__empty">
            <span class="salary-card__empty-icon" aria-hidden="true"><van-icon name="balance-pay" /></span>
            <div>
              <strong>{{ t('dashboard.noDepositsTitle') }}</strong>
              <p>{{ t('dashboard.noDepositsText') }}</p>
            </div>
          </div>
          <div v-else class="salary-list">
            <article v-for="deposit in sortedSalaryDeposits" :key="deposit.id" class="salary-entry">
              <div class="salary-entry__main">
                <div class="salary-entry__when">
                  <strong>{{ deposit.paidAt }}</strong>
                  <small v-if="deposit.periodStart || deposit.periodEnd">
                    {{ t('dashboard.payPeriod', { start: deposit.periodStart || t('dashboard.noPeriodStart'), end: deposit.periodEnd || t('dashboard.noPeriodEnd') }) }}
                  </small>
                </div>
                <div class="salary-entry__amount"><small>{{ t('dashboard.netDeposit') }}</small><strong>{{ money(deposit.amountCents) }}</strong></div>
              </div>
              <p v-if="deposit.grossCents != null || deposit.taxCents != null" class="salary-entry__extra">
                <span v-if="deposit.grossCents != null">{{ t('dashboard.grossAmount', { amount: money(deposit.grossCents) }) }}</span>
                <span v-if="deposit.taxCents != null">{{ t('dashboard.taxAmount', { amount: money(deposit.taxCents) }) }}</span>
              </p>
              <div class="salary-entry__actions">
                <van-button size="small" plain type="primary" @click="openSalaryEditor(deposit)">{{ t('common.edit') }}</van-button>
                <van-button size="small" plain type="danger" @click="removeSalary(deposit)">{{ t('common.delete') }}</van-button>
              </div>
            </article>
          </div>
        </section>


        <div class="analytics-grid">
          <section class="dashboard-section chart-card app-page__card" aria-labelledby="trend-title">
            <div class="section-head"><h2 id="trend-title">{{ t('dashboard.incomeTrend') }}</h2></div>
            <div
              v-if="summary.hasActualIncomeRecords || summary.hasEstimatedWorkRecords"
              class="mode-switch"
              :aria-label="t('dashboard.incomeBasisAria')"
            >
              <button
                type="button"
                :disabled="!summary.hasActualIncomeRecords"
                :class="{ selected: incomeMode === 'actual' }"
                @click="incomeMode = 'actual'"
              >
                {{ t('dashboard.actualIncome') }}
              </button>
              <button
                type="button"
                :disabled="!summary.hasEstimatedWorkRecords"
                :class="{ selected: incomeMode === 'estimated' }"
                @click="incomeMode = 'estimated'"
              >
                {{ t('dashboard.estimatedWorkIncome') }}
              </button>
            </div>
            <p class="scope-note">
              {{
                incomeMode === 'actual'
                  ? hasSalaryDeposits
                    ? t('dashboard.trendActualWithSalary')
                    : t('dashboard.trendActualFaresOnly')
                  : t('dashboard.trendEstimated')
              }}
            </p>
            <IncomeTrendChart
              :format="money"
              v-if="summary.hasActualIncomeRecords || summary.hasEstimatedWorkRecords"
              :points="summary.days"
              :mode="incomeMode"
              :active="active"
              @select="selectedIncomePoint = $event"
            />
            <p v-else class="empty-copy">{{ t('dashboard.noIncome') }}</p>
            <p v-if="selectedIncomePoint" class="chart-selection">
              {{ selectedIncomePoint.date }} ·
              {{
                incomeMode === 'actual'
                  ? money(selectedIncomePoint.actualCents)
                  : money(selectedIncomePoint.estimatedCents)
              }}（{{
                incomeMode === 'actual'
                  ? t('dashboard.faresReceived', { amount: money(selectedIncomePoint.tripCents) }) + (hasSalaryDeposits ? t('format.listSeparator') + t('dashboard.salaryDepositAmount', { amount: money(selectedIncomePoint.salaryCents) }) : '')
                  : t('dashboard.workEstimate')
              }}）
            </p>
            <van-collapse
              v-if="summary.hasActualIncomeRecords || summary.hasEstimatedWorkRecords"
              v-model="incomeDetailsOpen"
              class="daily-collapse"
            >
              <van-collapse-item name="daily" :title="t('dashboard.viewDaily')">
                <button
                  v-for="point in summary.days"
                  :key="point.date"
                  type="button"
                  class="daily-row"
                  @click="selectedIncomePoint = point"
                >
                  <span>{{ point.date }}</span>
                  <strong>{{
                    money(incomeMode === 'actual' ? point.actualCents : point.estimatedCents)
                  }}</strong>
                </button>
              </van-collapse-item>
            </van-collapse>
            <p
              v-if="summary.hasActualIncomeRecords || summary.hasEstimatedWorkRecords"
              class="chart-hint"
            >
              {{ t('dashboard.tapLine') }}
            </p>
          </section>

          <section class="dashboard-section chart-card app-page__card" aria-labelledby="expense-title">
            <div class="section-head"><h2 id="expense-title">{{ t('dashboard.expenseBreakdown') }}</h2></div>
            <p class="scope-note">
              {{ t('dashboard.expenseBreakdownNote') }}
            </p>
            <ExpenseDonutChart
              :format="money"
              v-if="summary.distribution.totalCents > 0"
              :distribution="localizedDistribution"
              :active="active"
              @select="selectedExpenseGroup = $event"
            />
            <p v-else class="empty-copy">{{ t('dashboard.noPaidExpenses') }}</p>
            <p v-if="selectedExpenseGroup" class="chart-selection">
              {{ expenseGroupLabel(selectedExpenseGroup.id, selectedExpenseGroup.label) }} · {{ money(selectedExpenseGroup.amountCents) }}
            </p>
            <div v-if="summary.distribution.detail.length" class="category-list">
              <button
                v-for="entry in summary.distribution.detail"
                :key="entry.id"
                type="button"
                @click="selectedExpenseGroup = entry"
              >
                <span class="category-name"
                  ><i :style="{ background: entry.color }"></i>{{ expenseGroupLabel(entry.id, entry.label) }}</span
                >
                <span>{{ money(entry.amountCents) }} · {{ entry.percent }}%</span>
              </button>
            </div>
          </section>
        </div>

        <section class="dashboard-section work-card app-page__card" aria-labelledby="work-title">
          <div class="section-head">
            <h2 id="work-title">{{ t('dashboard.designatedWork') }}</h2>
            <van-button size="small" plain type="primary" @click="openTargetEditor">{{
              workDayTarget === null ? t('dashboard.setTarget') : t('dashboard.editTarget')
            }}</van-button>
          </div>
          <p class="scope-note">{{ t('dashboard.allMarkedDays') }}</p>
          <div class="work-count">
            <strong>{{ workProgress.count }}</strong
            ><span>{{ t('dashboard.markedDays') }}{{ workDayTarget === null ? '' : t('dashboard.targetDays', { count: workDayTarget }) }}</span>
          </div>
          <template v-if="workDayTarget !== null"
            ><van-progress
              :percentage="workProgress.progressPercent"
              :show-pivot="false"
              color="#1989fa"
              track-color="#e6edf5"
            />
            <p class="goal-result">{{ t('dashboard.daysToGo', { count: workProgress.remaining }) }}</p></template
          >
          <p v-else class="empty-copy">{{ t('dashboard.noTarget') }}</p>
          <van-collapse v-if="eligibleDates.length" v-model="workDetailsOpen" class="work-collapse"
            ><van-collapse-item name="dates" :title="t('dashboard.manageMarks')"
              ><div v-for="date in eligibleDates" :key="date" class="work-date">
                <span>{{ date }}</span
                ><van-switch
                  :model-value="workProgress.dates.includes(date)"
                  size="22px"
                  :aria-label="t('dashboard.markAria', { date })"
                  @update:model-value="emit('mark-work-date', { date, marked: $event })"
                /></div></van-collapse-item
          ></van-collapse>
          <van-button v-else size="small" plain type="primary" @click="emit('navigate', 'payroll')"
            >{{ t('dashboard.goAddWork') }}</van-button
          >
          <p class="disclaimer">{{ t('dashboard.personalRecordOnly') }}</p>
        </section>
        </div>
      </section>
    </div>
    </div>

    <DashboardCustomizeSheet
      v-model:show="customizeOpen"
      :layout="layout"
      :context="layoutContext"
      @change="updateLayout"
    />
    <van-popup v-model:show="showGoalForm" position="bottom" round safe-area-inset-bottom>
      <form class="edit-sheet" @submit.prevent="saveGoal">
        <h2>{{ t('dashboard.savingsGoalTitle') }}</h2>
        <van-field
          v-model="goalForm.name"
          :label="t('dashboard.goalName')"
          :placeholder="t('dashboard.goalNamePlaceholder')"
          maxlength="40"
        />
        <van-field v-model="goalForm.target" :label="t('dashboard.goalTarget')" type="number" :placeholder="t('dashboard.greaterThanZero')" />
        <van-field
          v-model="goalForm.initial"
          :label="t('dashboard.initialSaving')"
          type="number"
          :placeholder="t('dashboard.canBeNegative')"
        />
        <van-field v-model="goalForm.startDate" :label="t('dashboard.startDate')" type="date" />
        <van-field v-model="goalForm.endDate" :label="t('dashboard.endDate')" type="date" />
        <p class="scope-note">{{ t('dashboard.initialSavingNote') }}{{ authToken ? t('dashboard.goalSavedToAccount') : t('dashboard.goalGuestNotKept') }}</p>
        <van-button class="app-page__action" block type="primary" native-type="submit"
          >{{ t('dashboard.saveGoal') }}</van-button
        >
      </form>
    </van-popup>
    <van-popup v-model:show="showSalaryForm" position="bottom" round safe-area-inset-bottom>
      <form class="edit-sheet salary-sheet" @submit.prevent="saveSalary">
        <h2>{{ editingSalaryId ? t('dashboard.editSalary') : t('dashboard.newSalary') }}</h2>
        <p class="scope-note">{{ t('dashboard.salaryFormNote') }}</p>
        <van-field v-model="salaryForm.paidAt" :label="t('dashboard.depositDate')" type="date" required />
        <van-field v-model="salaryForm.amount" :label="t('dashboard.netDepositAud')" type="number" required />
        <van-field v-model="salaryForm.gross" :label="t('dashboard.grossAudOptional')" type="number" />
        <van-field v-model="salaryForm.tax" :label="t('dashboard.taxAudOptional')" type="number" />
        <van-field v-model="salaryForm.periodStart" :label="t('dashboard.periodStart')" type="date" />
        <van-field v-model="salaryForm.periodEnd" :label="t('dashboard.periodEnd')" type="date" />
        <van-button class="app-page__action" block type="primary" native-type="submit">{{ t('dashboard.saveDeposit') }}</van-button>
      </form>
    </van-popup>
    <van-popup v-model:show="showTargetForm" position="bottom" round safe-area-inset-bottom>
      <form class="edit-sheet" @submit.prevent="saveTarget">
        <h2>{{ t('dashboard.targetTitle') }}</h2>
        <van-field v-model="targetForm" :label="t('dashboard.targetDaysLabel')" type="digit" :placeholder="t('dashboard.targetDaysPlaceholder')" />
        <p class="scope-note">{{ t('dashboard.targetNote') }}</p>
        <van-button class="app-page__action" block type="primary" native-type="submit"
          >{{ t('dashboard.saveTarget') }}</van-button
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
.hero-currency {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}
.currency-note {
  margin: -4px 0 12px;
  color: var(--color-muted);
  font-size: 12px;
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
.home-header__brand {
  color: var(--color-primary);
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.02em;
  line-height: var(--touch-target);
}
.home-header__customize {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  min-height: var(--touch-target);
  margin-left: auto;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-primary);
  font: inherit;
  font-size: var(--font-caption);
  font-weight: 700;
  cursor: pointer;
}
.home-header__customize:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
/* 首頁模組：依「自訂首頁」排序（CSS order），間距統一由 gap 決定 */
.home-modules {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 14px;
}
.home-modules > :deep(*) {
  margin-top: 0;
}
.home-module {
  min-width: 0;
}
.home-module > :deep(*) {
  margin-top: 0;
}
.home-modules__empty {
  order: -1;
}
.home-header__language {
  flex: none;
  margin-left: auto;
  align-self: center;
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
.home-section-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 24px 2px 10px;
  color: var(--color-heading);
  font-size: 16px;
  font-weight: 800;
}
.home-section-title small {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 500;
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
.onboarding-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}
.onboarding-card__count {
  color: var(--color-muted);
  font-size: var(--font-caption);
  font-variant-numeric: tabular-nums;
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

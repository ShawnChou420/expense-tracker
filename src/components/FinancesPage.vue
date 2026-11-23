<script setup>
// 收支頁（Expense Tracker 3.0）：收入、支出、車資、一般收入一起看。
// 計算全部在 domain/finances.js；這裡只負責讀資料、篩選與顯示。
// 已確認收入／已支付支出／實際差額 與 投資績效、待收款、預估薪資 分開，不互相加總。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDateRange, formatMonthDay } from '../i18n/format.js'
import { expenseCategoryLabel, incomeCategoryLabel } from '../i18n/labels.js'
import { formatLocalDate, parseLocalDate } from '../domain/date.js'
import { getDashboardRange } from '../domain/dashboard.js'
import { formatCentsIn } from '../domain/displayCurrency.js'
import {
  FINANCE_FILTERS,
  filterFinanceItems,
  financeItemSign,
  getCustomRange,
  getFinanceItems,
  getFinanceSummary,
  groupFinanceItemsByDate,
} from '../domain/finances.js'
import { formatOriginalAmount } from '../domain/fx.js'
import {
  expenseRepository,
  financialEntryRepository,
  passengerRepository,
  salaryDepositRepository,
  subscribeToLedgerChanges,
  tripRepository,
} from '../repositories/appRepositories.js'
import { authToken } from '../services/authSession.js'
import FinancialEntrySheet from './FinancialEntrySheet.vue'

const props = defineProps({
  active: Boolean,
  workRecords: { type: Array, default: () => [] },
  displayCurrency: { type: Object, default: null },
  exchangeRates: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['navigate'])
const { t } = useI18n()

const today = formatLocalDate(new Date())
const period = ref('week')
const anchor = ref(today)
const customStart = ref(today.slice(0, 8) + '01')
const customEnd = ref(today)
const filter = ref('ALL')

const trips = ref([])
const expenses = ref([])
const passengers = ref([])
const entries = ref([])
/** @type {import('vue').Ref<Array<any> | null>} */
const salaryDeposits = ref(null)
const loading = ref(false)
const loadError = ref('')
// 一般收入（financial_entry）讀不到時（例如後端還沒更新）：其他收支照常顯示，只提示這一項
const entriesUnavailable = ref(false)

const range = computed(() =>
  period.value === 'custom'
    ? getCustomRange(customStart.value, customEnd.value)
    : getDashboardRange(anchor.value, period.value),
)
const isCurrent = computed(
  () => period.value === 'custom' || range.value?.start === getDashboardRange(today, period.value)?.start,
)

function setPeriod(value) {
  period.value = value
  anchor.value = today
}
function movePeriod(direction) {
  const date = parseLocalDate(anchor.value)
  if (!date) return
  if (period.value === 'week') date.setDate(date.getDate() + direction * 7)
  else date.setMonth(date.getMonth() + direction, 1)
  anchor.value = formatLocalDate(date)
}

const passengerNames = computed(() =>
  Object.fromEntries(passengers.value.map((passenger) => [passenger.id, passenger.name])),
)
const sources = computed(() => ({
  range: range.value,
  expenses: expenses.value,
  trips: trips.value,
  salaryDeposits: salaryDeposits.value,
  entries: entries.value,
  workRecords: props.workRecords,
  passengerNames: passengerNames.value,
}))
const summary = computed(() => getFinanceSummary(sources.value))
const items = computed(() => getFinanceItems(sources.value))
const groups = computed(() => groupFinanceItemsByDate(filterFinanceItems(items.value, filter.value)))

const money = (/** @type {number} */ cents) => formatCentsIn(cents, props.displayCurrency)
const signed = (/** @type {number} */ cents) =>
  `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents))}`

const filterLabels = computed(() => ({
  ALL: t('finances.page.filterAll'),
  INCOME: t('finances.page.filterIncome'),
  EXPENSE: t('finances.page.filterExpense'),
  FARE: t('finances.page.filterFare'),
}))

/** @param {any} item */
function itemTitle(item) {
  if (item.sourceType === 'SALARY_DEPOSIT') return t('finances.page.salary')
  if (item.sourceType === 'TRIP_CHARGE')
    return item.title ? t('finances.page.fareOf', { name: item.title }) : t('finances.page.fare')
  if (item.kind === 'TRANSFER') return item.title || t('finances.typeTransfer')
  if (item.title) return item.title
  if (item.sourceType === 'FINANCIAL_ENTRY' && item.detail?.entry?.type === 'INCOME')
    return incomeCategoryLabel(item.category)
  return expenseCategoryLabel(item.category)
}
/** @param {any} item */
function itemSubtitle(item) {
  const parts = []
  if (item.sourceType === 'FINANCIAL_ENTRY') {
    const entry = item.detail?.entry
    // 沒有說明時標題就是分類，不再重複
    if (item.title && entry?.type === 'INCOME') parts.push(incomeCategoryLabel(entry.category))
    else if (item.title && entry?.type === 'EXPENSE') parts.push(expenseCategoryLabel(entry.category))
    if (entry?.currency !== 'AUD') parts.push(formatOriginalAmount(entry.amountMinor, entry.currency))
  } else if (item.sourceType === 'EXPENSE' && item.title) {
    parts.push(expenseCategoryLabel(item.category))
  }
  return parts.filter(Boolean).join(' · ')
}
/** @param {any} item */
function itemBadge(item) {
  if (item.sourceType === 'TRIP_CHARGE') {
    if (item.status === 'UNPAID') return { text: t('finances.page.badgeUnpaid'), tone: 'pending' }
    if (item.status === 'PARTIAL')
      return {
        text: t('finances.page.badgePartial', { amount: money(item.detail.receivedCents) }),
        tone: 'pending',
      }
    return { text: t('finances.page.badgeReceived'), tone: 'done' }
  }
  if (item.audCents === null) return { text: t('finances.unconverted'), tone: 'warn' }
  if (item.kind === 'TRANSFER') return { text: t('finances.page.notCounted'), tone: 'muted' }
  if (item.kind === 'INVESTMENT') return { text: t('finances.page.investment'), tone: 'muted' }
  if (item.basis === 'PLANNED') return { text: t('finances.statusPlanned'), tone: 'pending' }
  if (item.category === 'REFUND') return { text: t('finances.page.notCounted'), tone: 'muted' }
  return null
}
/** @param {any} item */
function itemAmount(item) {
  if (item.audCents === null) return formatOriginalAmount(item.original.amountMinor, item.original.currency)
  const sign = financeItemSign(item)
  return sign === 0 ? money(item.audCents) : signed(sign * item.audCents)
}
/** @param {any} item */
function itemTone(item) {
  const sign = financeItemSign(item)
  if (item.audCents === null || sign === 0 || item.basis !== 'ACTUAL') return 'neutral'
  return sign > 0 ? 'income' : 'expense'
}

const sheet = ref({ show: false, entry: null, type: 'INCOME' })
function openSheet(type = 'INCOME', entry = null) {
  sheet.value = { show: true, entry, type }
}
/** @param {any} item */
function openItem(item) {
  if (item.sourceType === 'FINANCIAL_ENTRY') openSheet(item.detail.entry.type, item.detail.entry)
  else if (item.sourceType === 'EXPENSE') emit('navigate', 'expenses')
  else if (item.sourceType === 'TRIP_CHARGE') emit('navigate', 'trips')
}

let seq = 0
async function refresh() {
  const current = ++seq
  loading.value = true
  try {
    const [nextTrips, nextExpenses, nextPassengers, nextDeposits, nextEntries] = await Promise.all([
      tripRepository.list(),
      expenseRepository.list(),
      passengerRepository.list(),
      salaryDepositRepository.list().catch(() => null),
      financialEntryRepository.list().catch(() => null),
    ])
    if (current !== seq) return
    trips.value = nextTrips || []
    expenses.value = nextExpenses || []
    passengers.value = nextPassengers || []
    salaryDeposits.value = nextDeposits
    entries.value = nextEntries || []
    entriesUnavailable.value = nextEntries === null
    loadError.value = ''
  } catch (error) {
    if (current === seq) loadError.value = /** @type {Error} */ (error).message
  } finally {
    if (current === seq) loading.value = false
  }
}

let loaded = false
watch(
  () => props.active,
  (active) => {
    if (active && !loaded) {
      loaded = true
      refresh()
    }
  },
  { immediate: true },
)
watch(authToken, () => {
  seq += 1
  trips.value = []
  expenses.value = []
  passengers.value = []
  entries.value = []
  salaryDeposits.value = null
  loaded = false
  if (props.active) {
    loaded = true
    refresh()
  }
})
let unsubscribe = () => {}
onMounted(() => {
  unsubscribe = subscribeToLedgerChanges(() => {
    if (loaded) refresh()
  })
})
onUnmounted(() => unsubscribe())

defineExpose({ openSheet })
</script>

<template>
  <main class="finances-page app-page" data-testid="finances-page">
    <header class="app-page__header">
      <div>
        <h1>{{ t('finances.page.title') }}</h1>
        <p>{{ t('finances.page.subtitle') }}</p>
      </div>
      <van-button
        type="primary"
        size="small"
        icon="plus"
        class="finances-page__add"
        @click="openSheet('INCOME')"
      >
        {{ t('finances.page.add') }}
      </van-button>
    </header>

    <section class="period app-page__card" :aria-label="t('period.filterAria')">
      <div class="period__modes">
        <button type="button" :class="{ selected: period === 'week' }" @click="setPeriod('week')">
          {{ t('common.thisWeek') }}
        </button>
        <button type="button" :class="{ selected: period === 'month' }" @click="setPeriod('month')">
          {{ t('common.thisMonth') }}
        </button>
        <button type="button" :class="{ selected: period === 'custom' }" @click="setPeriod('custom')">
          {{ t('finances.page.custom') }}
        </button>
      </div>
      <div v-if="period !== 'custom'" class="period__nav">
        <button type="button" :aria-label="t('period.previous')" @click="movePeriod(-1)">
          <van-icon name="arrow-left" />
        </button>
        <strong>{{ formatDateRange(range) }}</strong>
        <button type="button" :aria-label="t('period.next')" @click="movePeriod(1)">
          <van-icon name="arrow" />
        </button>
      </div>
      <div v-else class="period__custom">
        <label>
          <span>{{ t('finances.page.from') }}</span>
          <input v-model="customStart" type="date" />
        </label>
        <label>
          <span>{{ t('finances.page.to') }}</span>
          <input v-model="customEnd" type="date" />
        </label>
      </div>
      <button v-if="!isCurrent" type="button" class="period__reset" @click="anchor = today">
        {{ t('finances.page.backToCurrent') }}
      </button>
      <p v-if="!range" class="period__error">{{ t('finances.page.customInvalid') }}</p>
    </section>

    <p v-if="loadError" class="finances-page__error">{{ loadError }}</p>
    <p v-else-if="entriesUnavailable" class="finances-page__error" data-testid="finances-entries-unavailable">
      {{ t('finances.page.entriesUnavailable') }}
    </p>

    <section class="actual app-page__card" data-testid="finances-actual">
      <div class="actual__net">
        <span>{{ t('finances.page.net') }}</span>
        <strong :class="summary.netCents < 0 ? 'is-expense' : 'is-income'">{{
          signed(summary.netCents)
        }}</strong>
        <small>{{ t('finances.page.netHint') }}</small>
      </div>
      <div class="actual__split">
        <div>
          <span>{{ t('finances.page.confirmedIncome') }}</span>
          <strong class="is-income">{{ money(summary.confirmedIncomeCents) }}</strong>
        </div>
        <div>
          <span>{{ t('finances.page.paidExpense') }}</span>
          <strong class="is-expense">{{ money(summary.paidExpenseCents) }}</strong>
        </div>
      </div>
      <p v-for="item in summary.unconverted" :key="item.currency" class="actual__note">
        {{
          t('finances.page.unconvertedNote', {
            count: item.count,
            amount: formatOriginalAmount(item.amountMinor, item.currency),
          })
        }}
      </p>
    </section>

    <section class="side-cards" :aria-label="t('finances.page.separateAria')">
      <div class="side-card app-page__card">
        <span>{{ t('finances.page.estimatedPay') }}</span>
        <strong>{{ money(summary.estimatedPayCents) }}</strong>
        <small>{{ t('finances.page.estimatedPayHint') }}</small>
      </div>
      <div class="side-card app-page__card">
        <span>{{ t('finances.page.receivable') }}</span>
        <strong>{{ money(summary.receivable.totalCents) }}</strong>
        <small>{{
          t('finances.page.receivableHint', {
            fare: money(summary.receivable.fareCents),
            planned: money(summary.receivable.plannedIncomeCents),
          })
        }}</small>
      </div>
      <div class="side-card app-page__card">
        <span>{{ t('finances.page.investment') }}</span>
        <strong :class="summary.investment.netCents < 0 ? 'is-expense' : ''">{{
          signed(summary.investment.netCents)
        }}</strong>
        <small>{{
          t('finances.page.investmentHint', {
            gain: money(summary.investment.gainCents),
            loss: money(summary.investment.lossCents),
          })
        }}</small>
      </div>
      <div v-if="summary.refundCents || summary.transferCount" class="side-card app-page__card">
        <span>{{ t('finances.page.notCounted') }}</span>
        <strong>{{ money(summary.refundCents) }}</strong>
        <small>{{
          t('finances.page.notCountedHint', {
            refund: money(summary.refundCents),
            count: summary.transferCount,
          })
        }}</small>
      </div>
    </section>

    <div class="filters" role="group" :aria-label="t('finances.page.filterAria')">
      <button
        v-for="id in FINANCE_FILTERS"
        :key="id"
        type="button"
        :class="{ selected: filter === id }"
        :aria-pressed="filter === id"
        @click="filter = id"
      >
        {{ filterLabels[id] }}
      </button>
    </div>

    <div class="shortcuts">
      <button type="button" @click="emit('navigate', 'expenses')">
        <van-icon name="records" /> {{ t('finances.page.openExpenses') }}
      </button>
      <button type="button" @click="emit('navigate', 'trips')">
        <van-icon name="logistics" /> {{ t('finances.page.openTrips') }}
      </button>
      <button type="button" @click="openSheet('EXPENSE')">
        <van-icon name="exchange" /> {{ t('finances.page.addForeign') }}
      </button>
    </div>

    <section v-if="groups.length" class="list" data-testid="finances-list">
      <div v-for="group in groups" :key="group.date" class="list__day">
        <h3>{{ formatMonthDay(group.date) }}</h3>
        <button
          v-for="item in group.items"
          :key="item.key"
          type="button"
          class="list__item app-page__card"
          :class="{ 'is-static': item.sourceType === 'SALARY_DEPOSIT' }"
          @click="openItem(item)"
        >
          <span class="list__text">
            <strong>{{ itemTitle(item) }}</strong>
            <small v-if="itemSubtitle(item)">{{ itemSubtitle(item) }}</small>
          </span>
          <span class="list__amount">
            <strong :class="`tone-${itemTone(item)}`">{{ itemAmount(item) }}</strong>
            <em v-if="itemBadge(item)" :class="`badge badge--${itemBadge(item)?.tone}`">{{
              itemBadge(item)?.text
            }}</em>
          </span>
        </button>
      </div>
    </section>
    <p v-else-if="!loading" class="list__empty">{{ t('finances.page.empty') }}</p>

    <FinancialEntrySheet
      v-model:show="sheet.show"
      :entry="sheet.entry"
      :default-type="sheet.type"
      :exchange-rates="exchangeRates"
    />
  </main>
</template>

<style scoped>
.finances-page__add.van-button {
  flex: none;
  min-height: 40px;
  border-radius: 12px;
  font-weight: 800;
}
.period {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
}
.period__modes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.period__modes button {
  min-height: 38px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: transparent;
  color: var(--color-muted);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.period__modes button.selected {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.period__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.period__nav strong {
  min-width: 0;
  font-size: 15px;
  text-align: center;
}
.period__nav button {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.period__custom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.period__custom label {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
}
.period__custom input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 40px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: transparent;
  color: var(--color-heading);
  font: inherit;
}
.period__reset {
  justify-self: center;
  border: 0;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}
.period__error,
.finances-page__error {
  margin: 0;
  color: #c8362f;
  font-size: 13px;
}
.actual {
  display: grid;
  gap: 14px;
  margin-bottom: 12px;
  padding: 16px;
}
.actual__net {
  display: grid;
  gap: 2px;
}
.actual__net span,
.actual__split span,
.side-card span {
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}
.actual__net strong {
  font-size: clamp(28px, 8vw, 34px);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.actual__net small,
.side-card small {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.4;
}
.actual__split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.actual__split div {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--color-background);
}
.actual__split strong {
  overflow-wrap: anywhere;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}
.actual__note {
  margin: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: #fff6e5;
  color: #8a5a00;
  font-size: 12px;
}
.is-income {
  color: #13875f;
}
.is-expense {
  color: #c8362f;
}
.side-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.side-card {
  display: grid;
  align-content: start;
  gap: 3px;
  min-width: 0;
  padding: 12px 14px;
}
.side-card strong {
  overflow-wrap: anywhere;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}
.filters,
.shortcuts {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.filters button {
  flex: none;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-heading);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.filters button.selected {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: #fff;
}
.shortcuts button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}
.list__day h3 {
  margin: 14px 4px 8px;
  color: var(--color-muted);
  font-size: 13px;
}
.list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  margin-bottom: 8px;
  padding: 12px 14px;
  border: 0;
  color: var(--color-heading);
  font: inherit;
  text-align: left;
}
.list__item.is-static {
  cursor: default;
}
.list__text {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.list__text strong {
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list__text small {
  color: var(--color-muted);
  font-size: 12px;
}
.list__amount {
  display: grid;
  flex: none;
  justify-items: end;
  gap: 3px;
  max-width: 55%;
}
.list__amount strong {
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.tone-income {
  color: #13875f;
}
.tone-expense {
  color: #c8362f;
}
.tone-neutral {
  color: var(--color-heading);
}
.badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  text-align: right;
}
.badge--pending {
  background: #fff1d6;
  color: #8a5a00;
}
.badge--warn {
  background: #ffe7e4;
  color: #a3271f;
}
.badge--done {
  background: #e3f6ee;
  color: #13875f;
}
.badge--muted {
  background: var(--color-background);
  color: var(--color-muted);
}
.list__empty {
  margin: 24px 0;
  color: var(--color-muted);
  text-align: center;
}
</style>

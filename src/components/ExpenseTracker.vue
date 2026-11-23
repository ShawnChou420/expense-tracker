<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useI18n } from 'vue-i18n'
import { formatMonthDay } from '../i18n/format.js'
import { expenseCategoryLabel, expenseFrequencyLabel, expenseGroupLabel } from '../i18n/labels.js'
import { localizeMessage } from '../i18n/messages.js'
import { formatLocalDate, getWeekRange, parseLocalDate } from '../domain/date.js'
import {
  createExpense,
  EXPENSE_FREQUENCIES,
  EXPENSE_GROUPS,
  getExpenseCategory,
  getExpenseGroup,
  getExpenseOccurrences,
  getExpenseSummary,
  getQuickCategories,
} from '../domain/expenses.js'
import { dollarsToCents, formatAud, formatCentsInput } from '../domain/money.js'
import { expenseRepository, subscribeToLedgerChanges } from '../repositories/appRepositories.js'
import { authToken } from '../services/authSession.js'

const { t, locale } = useI18n()
const repository = expenseRepository
const expenses = ref([])
const selectedDate = ref(formatLocalDate(new Date()))
const filter = ref('ALL')
const showForm = ref(false)
const showPaymentForm = ref(false)
const payingOccurrence = ref(null)
const paymentDate = ref(formatLocalDate(new Date()))
const editingId = ref(null)
const form = ref(emptyForm())
// 記帳表單：金額優先，分類先顯示常用的幾個，其他欄位收在「更多選項」
const amountInput = ref(null)
const showAllCategories = ref(false)
const moreOptionsOpen = ref(false)
const quickCategories = computed(() => {
  const list = getQuickCategories(expenses.value)
  const selected = getExpenseCategory(form.value.group, form.value.category)
  const included = list.some(
    (item) => item.group === form.value.group && item.category === form.value.category,
  )
  return selected && !included
    ? [{ group: form.value.group, category: form.value.category, label: selected.label }, ...list]
    : list
})
function pickQuickCategory(item) {
  form.value.group = item.group
  selectCategory({ id: item.category })
}
function focusAmount() {
  // 新增時打開就準備輸入金額（iOS 可能需要再點一下才會出現鍵盤）
  if (!editingId.value) amountInput.value?.focus()
}

const weekRange = computed(() => getWeekRange(selectedDate.value))
const summary = computed(() => getExpenseSummary(expenses.value, weekRange.value))
const selectedGroup = computed(() => getExpenseGroup(form.value.group))
const weekLabel = computed(() => {
  void locale.value
  return `${formatMonthDay(weekRange.value.start)} – ${formatMonthDay(weekRange.value.end)}`
})
const weeklyExpenses = computed(() =>
  getExpenseOccurrences(expenses.value, weekRange.value)
    .filter((expense) => filter.value === 'ALL' || expense.group === filter.value)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
)
const activeGroups = computed(() =>
  EXPENSE_GROUPS.filter((group) =>
    getExpenseOccurrences(expenses.value, weekRange.value).some(
      (expense) => expense.group === group.id,
    ),
  ),
)

function emptyForm() {
  return {
    date: formatLocalDate(new Date()),
    group: 'FOOD',
    category: 'GROCERIES',
    amount: '',
    title: '',
    note: '',
    status: 'PAID',
    frequency: 'NONE',
    intervalDays: '',
    endDate: '',
    paidDates: [],
    paidAt: formatLocalDate(new Date()),
  }
}

function moveWeek(direction) {
  const date = parseLocalDate(selectedDate.value)
  date.setDate(date.getDate() + direction * 7)
  selectedDate.value = formatLocalDate(date)
  filter.value = 'ALL'
}

function selectCurrentWeek() {
  selectedDate.value = formatLocalDate(new Date())
  filter.value = 'ALL'
}

function openForm(expense) {
  const source = expense && expenses.value.find((record) => record.id === expense.sourceId)
  editingId.value = source?.id || null
  form.value = source
    ? {
        ...source,
        amount: formatCentsInput(source.amountCents),
        intervalDays: source.intervalDays || '',
        endDate: source.endDate || '',
        status:
          source.frequency !== 'NONE' && source.paidDates.includes(source.date)
            ? 'PAID'
            : source.status,
        paidAt:
          source.payments?.find((payment) => payment.occurrenceDate === source.date)?.paidAt ||
          source.date,
      }
    : { ...emptyForm(), date: selectedDate.value }
  showAllCategories.value = false
  moreOptionsOpen.value = Boolean(
    source && (source.frequency !== 'NONE' || source.note || source.status !== 'PAID'),
  )
  showForm.value = true
}

function selectGroup(group) {
  form.value.group = group.id
  form.value.category = group.categories[0].id
}

function selectCategory(category) {
  form.value.category = category.id
  if (category.id === 'INVESTMENT_LOSS') {
    form.value.frequency = 'NONE'
    form.value.status = 'PAID'
  }
}

async function saveExpense() {
  const amountCents = dollarsToCents(form.value.amount)
  try {
    const previous = expenses.value.find((record) => record.id === editingId.value)
    if (
      previous?.paidDates?.length &&
      (previous.date !== form.value.date ||
        previous.frequency !== form.value.frequency ||
        previous.amountCents !== amountCents ||
        previous.group !== form.value.group ||
        previous.category !== form.value.category ||
        (previous.frequency === 'CUSTOM' &&
          Number(previous.intervalDays) !== Number(form.value.intervalDays)))
    ) {
      throw new Error(t('errors.expenseHasPaid'))
    }
    const record = createExpense({
      ...form.value,
      id: editingId.value || undefined,
      amountCents,
      paidDates:
        form.value.frequency === 'NONE'
          ? []
          : [
              ...(editingId.value
                ? form.value.paidDates.filter((date) => date !== form.value.date)
                : []),
              ...(form.value.status === 'PAID' ? [form.value.date] : []),
            ],
    })
    await repository.save(authToken.value ? { ...record, paidAt: form.value.paidAt } : record)
    expenses.value = await repository.list()
    selectedDate.value = record.date
    filter.value = 'ALL'
    showForm.value = false
    showToast(editingId.value ? t('expenses.updated') : t('expenses.recorded'))
    editingId.value = null
  } catch (error) {
    showToast(localizeMessage(error.message))
  }
}

async function togglePaid(occurrence) {
  if (authToken.value && occurrence.status !== 'PAID') {
    payingOccurrence.value = occurrence
    paymentDate.value = formatLocalDate(new Date())
    showPaymentForm.value = true
    return
  }
  const source = expenses.value.find((record) => record.id === occurrence.sourceId)
  if (authToken.value && occurrence.status === 'PAID') {
    try {
      await showConfirmDialog({
        title: t('expenses.removePaidTitle'),
        message: t('expenses.removePaidMessage'),
      })
    } catch {
      return
    }
  }
  const updated =
    source.frequency === 'NONE'
      ? createExpense({ ...source, status: source.status === 'PAID' ? 'PLANNED' : 'PAID' })
      : createExpense({
          ...source,
          paidDates: source.paidDates.includes(occurrence.date)
            ? source.paidDates.filter((date) => date !== occurrence.date)
            : [...source.paidDates, occurrence.date],
        })
  await repository.save(updated)
  expenses.value = await repository.list()
  showToast(occurrence.status === 'PAID' ? t('expenses.markedPlanned') : t('expenses.markedPaid'))
}

async function savePayment() {
  if (!payingOccurrence.value || !parseLocalDate(paymentDate.value)) {
    showToast(t('expenses.invalidPaymentDate'))
    return
  }
  try {
    await repository.recordPayment(payingOccurrence.value.sourceId, {
      occurrenceDate: payingOccurrence.value.date,
      paidAt: paymentDate.value,
      amountCents: payingOccurrence.value.amountCents,
    })
    showPaymentForm.value = false
    await refreshExpenses()
    showToast(t('expenses.paymentRecorded'))
  } catch (error) {
    showToast(localizeMessage(error.message))
  }
}

async function removeExpense(expense) {
  const source = expenses.value.find((record) => record.id === expense.sourceId)
  try {
    await showConfirmDialog({
      title:
        source.frequency === 'NONE'
          ? t('expenses.deleteOneTitle')
          : t('expenses.deleteSeriesTitle'),
      message:
        source.frequency === 'NONE'
          ? t('expenses.deleteOneMessage', {
              date: expense.date,
              amount: formatAud(expense.amountCents),
            })
          : t('expenses.deleteSeriesMessage'),
    })
  } catch {
    return
  }
  await repository.remove(source.id)
  expenses.value = await repository.list()
  showToast(t('expenses.deleted'))
}
let unsubscribeLedger = null
async function refreshExpenses() {
  const identity = authToken.value
  const next = await repository.list()
  if (identity === authToken.value) expenses.value = next
}
onMounted(() => {
  unsubscribeLedger = subscribeToLedgerChanges(() =>
    refreshExpenses().catch((error) => showToast(localizeMessage(error.message))),
  )
  refreshExpenses().catch((error) => showToast(localizeMessage(error.message)))
})
onUnmounted(() => unsubscribeLedger?.())
watch(authToken, () => {
  expenses.value = []
  refreshExpenses().catch((error) => showToast(localizeMessage(error.message)))
})

// 讓首頁快捷操作可以直接打開新增表單
defineExpose({ openForm })
</script>

<template>
  <section class="expense-page app-page">
    <header class="page-header app-page__header">
      <div>
        <h1>{{ t('expenses.title') }}</h1>
        <p>{{ t('expenses.subtitle') }}</p>
      </div>
      <van-button
        class="app-page__action header-action"
        type="primary"
        size="small"
        icon="plus"
        @click="openForm()"
        >{{ t('expenses.add') }}</van-button
      >
    </header>

    <section class="overview app-page__card" aria-labelledby="expense-overview-title">
      <div class="overview-top">
        <div>
          <h2 id="expense-overview-title">{{ t('expenses.weekTotal') }}</h2>
        </div>
        <button type="button" class="today-link" @click="selectCurrentWeek">
          {{ t('expenses.backToThisWeek') }}
        </button>
      </div>
      <div class="week-switcher" :aria-label="t('expenses.switchWeekAria')">
        <button type="button" :aria-label="t('common.previousWeek')" @click="moveWeek(-1)">
          <van-icon name="arrow-left" />
        </button>
        <span
          >{{ weekLabel }} <small>{{ t('expenses.monToSun') }}</small></span
        >
        <button type="button" :aria-label="t('common.nextWeek')" @click="moveWeek(1)">
          <van-icon name="arrow" />
        </button>
      </div>
      <div v-if="summary.count" class="overview-amount">
        <span>{{ t('expenses.paid') }}</span
        ><strong>{{ formatAud(summary.paidCents) }}</strong
        ><small>{{ t('expenses.paidNote') }}</small>
      </div>
      <div v-if="summary.count" class="overview-bottom">
        <span
          >{{ t('expenses.planned') }} <strong>{{ formatAud(summary.plannedCents) }}</strong></span
        ><span>{{ t('expenses.recordCount', { count: summary.count }) }}</span>
      </div>
      <p v-if="summary.count" class="overview-note">{{ t('expenses.recurringNote') }}</p>
      <p v-else class="overview-empty">{{ t('expenses.noExpenses') }}</p>
    </section>

    <section class="records-section" aria-labelledby="records-title">
      <div class="section-heading">
        <div>
          <h2 id="records-title">{{ t('expenses.title') }}</h2>
        </div>
        <small>{{ t('expenses.countShort', { count: weeklyExpenses.length }) }}</small>
      </div>
      <div
        v-if="activeGroups.length"
        class="filter-row"
        :aria-label="t('expenses.groupFilterAria')"
      >
        <button type="button" :class="{ active: filter === 'ALL' }" @click="filter = 'ALL'">
          {{ t('expenses.all') }}
        </button>
        <button
          v-for="group in activeGroups"
          :key="group.id"
          type="button"
          :class="{ active: filter === group.id }"
          @click="filter = group.id"
        >
          {{ expenseGroupLabel(group.id, group.label) }}
        </button>
      </div>
      <div v-if="weeklyExpenses.length === 0" class="empty-card">
        <strong>{{
          filter === 'ALL' ? t('expenses.noExpenses') : t('expenses.noneInCategory')
        }}</strong>
        <span>{{ t('expenses.startHint') }}</span>
        <van-button
          v-if="filter === 'ALL'"
          class="app-page__action"
          type="primary"
          size="small"
          @click="openForm()"
          >{{ t('expenses.addShort') }}</van-button
        >
      </div>
      <article v-for="expense in weeklyExpenses" :key="expense.occurrenceId" class="expense-card">
        <div class="expense-card__main">
          <span class="expense-card__icon"
            ><van-icon :name="getExpenseGroup(expense.group).icon"
          /></span>
          <div class="expense-card__info">
            <strong>{{
              expense.title ||
              expenseCategoryLabel(
                expense.category,
                getExpenseCategory(expense.group, expense.category).label,
              )
            }}</strong
            ><span
              >{{ expense.date }} ·
              {{ expenseGroupLabel(expense.group, getExpenseGroup(expense.group).label) }} /
              {{
                expenseCategoryLabel(
                  expense.category,
                  getExpenseCategory(expense.group, expense.category).label,
                )
              }}</span
            >
          </div>
          <strong class="expense-card__amount">−{{ formatAud(expense.amountCents) }}</strong>
        </div>
        <div class="expense-card__foot">
          <span
            :class="[
              'status-pill',
              expense.status === 'PAID' ? 'status-pill--paid' : 'status-pill--planned',
            ]"
            >{{ expense.status === 'PAID' ? t('expenses.paid') : t('expenses.planned') }}</span
          >
          <span v-if="expense.frequency !== 'NONE'" class="frequency-pill">{{
            expenseFrequencyLabel(
              expense.frequency,
              EXPENSE_FREQUENCIES.find((item) => item.id === expense.frequency)?.label,
            )
          }}</span>
          <span v-if="expense.note" class="expense-card__note">{{ expense.note }}</span>
          <div class="expense-card__actions">
            <button type="button" class="payment-action" @click="togglePaid(expense)">
              {{ expense.status === 'PAID' ? t('expenses.markUnpaid') : t('expenses.markPaid') }}
            </button>
            <button type="button" @click="openForm(expense)">{{ t('common.edit') }}</button
            ><button type="button" @click="removeExpense(expense)">{{ t('common.delete') }}</button>
          </div>
        </div>
      </article>
    </section>

    <section
      v-if="summary.byGroup.length"
      class="category-section"
      aria-labelledby="category-title"
    >
      <div class="section-heading">
        <h2 id="category-title">{{ t('expenses.whereItWent') }}</h2>
        <small>{{ t('expenses.paidOnly') }}</small>
      </div>
      <div class="category-breakdown">
        <div v-for="group in summary.byGroup" :key="group.id" class="category-row">
          <span class="category-icon"><van-icon :name="group.icon" /></span>
          <span class="category-name">{{ expenseGroupLabel(group.id, group.label) }}</span>
          <strong>{{ formatAud(group.amountCents) }}</strong>
        </div>
      </div>
    </section>

    <p v-if="summary.investmentLossCents" class="investment-note">
      {{ t('expenses.investmentLossRecorded', { amount: formatAud(summary.investmentLossCents) }) }}
    </p>

    <van-popup
      v-model:show="showForm"
      position="bottom"
      round
      safe-area-inset-bottom
      @opened="focusAmount"
    >
      <form class="sheet-form" @submit.prevent="saveExpense">
        <div class="sheet-header">
          <div>
            <h2>{{ editingId ? t('expenses.edit') : t('expenses.add') }}</h2>
          </div>
          <button type="button" :aria-label="t('common.close')" @click="showForm = false">
            <van-icon name="cross" />
          </button>
        </div>
        <div class="sheet-scroll">
          <label class="amount-hero">
            <span class="amount-hero__currency">AUD $</span>
            <input
              ref="amountInput"
              v-model="form.amount"
              class="amount-hero__input"
              type="text"
              inputmode="decimal"
              enterkeyhint="done"
              placeholder="0.00"
              :aria-label="t('expenses.amountAria')"
              autocomplete="off"
            />
          </label>
          <div
            v-if="!showAllCategories"
            class="quick-categories"
            role="group"
            :aria-label="t('expenses.quickCategoryAria')"
          >
            <button
              v-for="item in quickCategories"
              :key="`${item.group}:${item.category}`"
              type="button"
              :class="{ selected: form.group === item.group && form.category === item.category }"
              @click="pickQuickCategory(item)"
            >
              {{ expenseCategoryLabel(item.category, item.label) }}
            </button>
            <button type="button" class="quick-categories__more" @click="showAllCategories = true">
              {{ t('expenses.moreCategories') }}
            </button>
          </div>
          <template v-else>
            <p class="field-label">{{ t('expenses.group') }}</p>
            <div class="group-picker">
              <button
                v-for="group in EXPENSE_GROUPS"
                :key="group.id"
                type="button"
                :class="{ selected: form.group === group.id }"
                @click="selectGroup(group)"
              >
                <van-icon :name="group.icon" /><span>{{
                  expenseGroupLabel(group.id, group.label)
                }}</span>
              </button>
            </div>
            <p class="field-label">{{ t('expenses.subcategory') }}</p>
            <div class="subcategory-picker">
              <button
                v-for="category in selectedGroup.categories"
                :key="category.id"
                type="button"
                :class="{ selected: form.category === category.id }"
                @click="selectCategory(category)"
              >
                {{ expenseCategoryLabel(category.id, category.label) }}
              </button>
            </div>
          </template>
          <p v-if="form.category === 'INVESTMENT_LOSS'" class="form-hint">
            {{ t('expenses.investmentHint') }}
          </p>
          <van-cell-group inset class="form-fields">
            <van-field v-model="form.date" :label="t('common.date')" type="date" required />
            <van-field
              v-if="authToken && form.status === 'PAID'"
              v-model="form.paidAt"
              :label="t('expenses.paidOn')"
              type="date"
              required
            />
            <van-field
              v-model="form.title"
              :label="t('expenses.merchantLabel')"
              :placeholder="t('expenses.merchantPlaceholder')"
              clearable
            />
          </van-cell-group>
          <button
            type="button"
            class="more-options"
            :aria-expanded="moreOptionsOpen"
            @click="moreOptionsOpen = !moreOptionsOpen"
          >
            {{ moreOptionsOpen ? t('expenses.hideMore') : t('expenses.showMore') }}
            <van-icon :name="moreOptionsOpen ? 'arrow-up' : 'arrow-down'" />
          </button>
          <template v-if="moreOptionsOpen">
            <van-cell-group inset class="form-fields">
              <van-field
                v-model="form.note"
                :label="t('common.note')"
                type="textarea"
                rows="2"
                autosize
                :placeholder="t('common.optional')"
                clearable
              />
            </van-cell-group>
            <p v-if="form.category !== 'INVESTMENT_LOSS'" class="field-label">
              {{ t('expenses.frequency') }}
            </p>
            <div v-if="form.category !== 'INVESTMENT_LOSS'" class="frequency-picker">
              <button
                v-for="frequency in EXPENSE_FREQUENCIES"
                :key="frequency.id"
                type="button"
                :class="{ selected: form.frequency === frequency.id }"
                @click="form.frequency = frequency.id"
              >
                {{ expenseFrequencyLabel(frequency.id, frequency.label) }}
              </button>
            </div>
            <van-cell-group v-if="form.frequency === 'CUSTOM'" inset class="interval-field"
              ><van-field
                v-model="form.intervalDays"
                :label="t('expenses.everyNDays')"
                type="number"
                inputmode="numeric"
                placeholder="1–365"
                required
            /></van-cell-group>
            <van-cell-group v-if="form.frequency !== 'NONE'" inset class="interval-field">
              <van-field
                v-model="form.endDate"
                :label="t('dashboard.endDate')"
                type="date"
                :placeholder="t('expenses.endDatePlaceholder')"
                clearable
              />
            </van-cell-group>
            <p v-if="form.frequency !== 'NONE'" class="form-hint">
              {{ t('expenses.scheduleHint') }}
            </p>
            <p v-if="form.category !== 'INVESTMENT_LOSS'" class="field-label">
              {{ t('expenses.paymentStatus') }}
            </p>
            <div v-if="form.category !== 'INVESTMENT_LOSS'" class="status-picker">
              <button
                type="button"
                :class="{ selected: form.status === 'PAID' }"
                @click="form.status = 'PAID'"
              >
                {{ t('expenses.paid') }}</button
              ><button
                type="button"
                :class="{ selected: form.status === 'PLANNED' }"
                @click="form.status = 'PLANNED'"
              >
                {{ t('expenses.planned') }}
              </button>
            </div>
            <p v-if="form.category !== 'INVESTMENT_LOSS'" class="status-hint">
              {{
                form.frequency === 'NONE' ? t('expenses.plannedHint') : t('expenses.firstOnlyHint')
              }}
            </p>
          </template>
        </div>
        <div class="sheet-footer">
          <van-button type="primary" block native-type="submit">{{
            editingId ? t('expenses.saveChanges') : t('expenses.saveExpense')
          }}</van-button>
        </div>
      </form>
    </van-popup>
    <van-popup v-model:show="showPaymentForm" position="bottom" round safe-area-inset-bottom>
      <form class="sheet-form" @submit.prevent="savePayment">
        <div class="sheet-header">
          <h2>{{ t('expenses.markPayment') }}</h2>
        </div>
        <p class="form-hint">{{ t('expenses.paymentHint', { date: payingOccurrence?.date }) }}</p>
        <van-field v-model="paymentDate" :label="t('expenses.paidOn')" type="date" required />
        <div class="sheet-footer">
          <van-button block type="primary" native-type="submit">{{
            t('expenses.confirmPaid')
          }}</van-button>
        </div>
      </form>
    </van-popup>
  </section>
</template>

<style scoped>
.expense-page {
  width: 100%;
  color: var(--color-heading);
}
.page-header,
.overview-top,
.week-switcher,
.overview-bottom,
.section-heading,
.category-row,
.expense-card__main,
.expense-card__foot,
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page-header {
  gap: 10px;
}
.header-action {
  flex: none;
  max-width: 48%;
  padding-inline: 12px;
  white-space: normal;
}
.overview {
  padding: 15px 16px;
}
.overview h2 {
  margin: 0;
  font-size: 17px;
}
.today-link {
  min-height: 38px;
  border: 0;
  background: transparent;
  color: #1976d2;
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
}
.week-switcher {
  margin-top: 10px;
  padding: 3px;
  border-radius: 13px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  text-align: center;
}
.week-switcher button {
  width: 42px;
  height: 42px;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 15px;
}
.week-switcher span {
  font-size: 14px;
  font-weight: 800;
}
.week-switcher small {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--color-subtle);
  font-weight: 400;
}
.overview-amount {
  display: flex;
  flex-direction: column;
  padding: 12px 3px 10px;
}
.overview-amount span {
  color: var(--color-muted);
  font-size: 13px;
}
.overview-amount strong {
  margin: 4px 0;
  color: #166dd1;
  font-size: clamp(28px, 8vw, 36px);
  line-height: 1.15;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}
.overview-amount small {
  color: #8b98a7;
  font-size: 11px;
}
.overview-bottom {
  flex-wrap: wrap;
  gap: 6px 12px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-soft);
  color: var(--color-muted);
  font-size: 12px;
}
.overview-bottom strong {
  margin-left: 5px;
  color: var(--color-heading);
  font-size: 14px;
}
.overview-note {
  margin: 8px 0 0;
  color: var(--color-subtle);
  font-size: 12px;
}
.overview-empty {
  margin: 10px 2px 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.45;
}
.investment-note {
  margin: 16px 2px 0;
  padding: 11px 13px;
  border-radius: 12px;
  background: #eef2f8;
  color: #566b82;
  font-size: 12px;
}
.section-heading {
  margin: 0 2px 12px;
}
.section-heading h2 {
  margin: 0;
  font-size: var(--font-heading);
  letter-spacing: -0.02em;
}
.section-heading small {
  color: var(--color-subtle);
  font-size: 12px;
}
.category-section {
  margin-top: var(--page-section-gap);
}
.records-section {
  margin-top: var(--page-section-gap);
}
.category-breakdown {
  padding: 4px 16px;
  border: 1px solid var(--color-border);
  border-radius: 20px;
  background: #fff;
}
.category-row {
  gap: 12px;
  min-height: 52px;
  border-bottom: 1px solid var(--color-border-soft);
  font-size: 13px;
}
.category-row:last-child {
  border: 0;
}
.category-icon,
.expense-card__icon {
  display: grid;
  flex: none;
  place-items: center;
  background: #eaf3fe;
  color: #1976d2;
  border-radius: 12px;
}
.category-icon {
  width: 32px;
  height: 32px;
}
.category-name {
  flex: 1;
}
.category-row strong {
  font-variant-numeric: tabular-nums;
}
.filter-row {
  display: flex;
  gap: 8px;
  overflow: auto;
  padding: 0 0 13px;
  scrollbar-width: none;
}
.filter-row button {
  flex: none;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 8px 14px;
  background: #fff;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
}
.filter-row button.active {
  border-color: #1976d2;
  background: #1976d2;
  color: #fff;
}
.empty-card {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 9px;
  padding: 17px 14px;
  border: 1px dashed #d7e3f0;
  border-radius: 20px;
  background: #fff;
  text-align: center;
}
.empty-card span {
  color: var(--color-subtle);
  font-size: 12px;
  line-height: 1.5;
}
.expense-card {
  margin: 0 0 10px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 19px;
  background: #fff;
  box-shadow: 0 4px 14px #1d426a0a;
}
.expense-card__main {
  gap: 11px;
  flex-wrap: wrap;
}
.expense-card__icon {
  width: 43px;
  height: 43px;
  font-size: 19px;
}
.expense-card__info {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 5px;
}
.expense-card__info strong {
  overflow-wrap: anywhere;
  font-size: 14px;
}
.expense-card__info span {
  color: var(--color-subtle);
  font-size: 11px;
}
.expense-card__amount {
  flex: none;
  margin-left: auto;
  overflow-wrap: anywhere;
  color: #166dd1;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}
.expense-card__foot {
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-soft);
}
.status-pill {
  flex: none;
  padding: 5px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
}
.status-pill--paid {
  background: #edf5ef;
  color: #398059;
}
.status-pill--planned {
  background: #fff1df;
  color: #ac752d;
}
.frequency-pill {
  flex: none;
  padding: 5px 8px;
  border-radius: 999px;
  background: #eaf3fe;
  color: #1976d2;
  font-size: 10px;
  font-weight: 800;
}
.expense-card__note {
  flex: 1;
  overflow: hidden;
  color: var(--color-subtle);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.expense-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}
.expense-card__actions button {
  min-height: 30px;
  padding: 0 7px;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
}
.expense-card__actions button:last-child {
  color: #c56868;
}
.expense-card__actions .payment-action {
  color: #1976d2;
}
.sheet-form {
  display: flex;
  flex-direction: column;
  max-height: min(88dvh, 760px);
  background: #f5f7fa;
}
.sheet-header {
  flex: none;
  padding: 19px 20px 12px;
}
.sheet-header h2 {
  margin: 0;
  font-size: 21px;
}
.sheet-header button {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: #eaf1f9;
  color: var(--color-text-secondary);
}
.sheet-scroll {
  overflow: auto;
  padding: 0 16px 22px;
  overscroll-behavior: contain;
}
.field-label {
  margin: 18px 4px 10px;
  font-size: 13px;
  font-weight: 800;
}
.amount-hero {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 4px 0 14px;
  padding: 14px 16px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-surface);
}
.amount-hero:focus-within {
  border-color: var(--color-primary);
}
.amount-hero__currency {
  flex: none;
  color: var(--color-muted);
  font-size: 15px;
  font-weight: 700;
}
.amount-hero__input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--color-heading);
  font: inherit;
  font-size: 34px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.quick-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.quick-categories button,
.more-options {
  min-height: var(--touch-target);
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-heading);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.quick-categories button.selected {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.quick-categories .quick-categories__more {
  border-style: dashed;
  color: var(--color-primary);
}
.more-options {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin: 12px 0 4px;
  border: 0;
  border-radius: var(--radius-medium);
  background: transparent;
  color: var(--color-primary);
  font-size: 13px;
}
.group-picker {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
.group-picker button {
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  min-height: 65px;
  padding: 6px 2px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #fff;
  color: var(--color-muted);
  font-size: 10px;
}
.group-picker button .van-icon {
  font-size: 19px;
}
.group-picker button.selected {
  border-color: #1976d2;
  background: #eaf3fe;
  color: #166dd1;
  font-weight: 800;
}
.subcategory-picker,
.frequency-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.subcategory-picker button,
.frequency-picker button {
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: #fff;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
}
.subcategory-picker button.selected,
.frequency-picker button.selected {
  border-color: #1976d2;
  background: #eaf3fe;
  color: #166dd1;
}
.form-hint {
  margin: 10px 4px 0;
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.5;
}
.interval-field {
  margin-top: 12px;
}
.form-fields {
  margin: 20px 0 0;
}
.status-picker {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}
.status-picker button {
  min-height: 43px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: #fff;
  color: var(--color-muted);
  font-weight: 700;
}
.status-picker button.selected {
  border-color: #1976d2;
  background: #eaf3fe;
  color: #166dd1;
}
.status-hint {
  margin: 9px 4px 0;
  color: var(--color-subtle);
  font-size: 11px;
}
.sheet-footer {
  flex: none;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--color-border);
  background: #fff;
}
.sheet-footer .van-button {
  height: 48px;
  border: 0;
  border-radius: 12px;
  background: #1989fa;
  font-weight: 800;
}
@media (min-width: 720px) {
  .expense-page {
    max-width: 820px;
    margin: auto;
  }
  .group-picker {
    grid-template-columns: repeat(5, 1fr);
  }
}
@media (max-width: 370px) {
  .group-picker {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>

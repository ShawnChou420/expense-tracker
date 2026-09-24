<script setup>
import { computed, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { formatLocalDate, getWeekRange, parseLocalDate } from '../domain/date.js'
import {
  createExpense,
  EXPENSE_FREQUENCIES,
  EXPENSE_GROUPS,
  getExpenseCategory,
  getExpenseGroup,
  getExpenseOccurrences,
  getExpenseSummary,
} from '../domain/expenses.js'
import { dollarsToCents, formatAud, formatCentsInput } from '../domain/money.js'
import { expenseRepository } from '../repositories/appRepositories.js'

const repository = expenseRepository
const expenses = ref([])
const selectedDate = ref(formatLocalDate(new Date()))
const filter = ref('ALL')
const showForm = ref(false)
const editingId = ref(null)
const form = ref(emptyForm())

const weekRange = computed(() => getWeekRange(selectedDate.value))
const summary = computed(() => getExpenseSummary(expenses.value, weekRange.value))
const selectedGroup = computed(() => getExpenseGroup(form.value.group))
const weekLabel = computed(
  () => `${weekRange.value.start.slice(5)} – ${weekRange.value.end.slice(5)}`,
)
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
      }
    : { ...emptyForm(), date: selectedDate.value }
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
      throw new Error('已有已付紀錄；請結束舊排程，再新增不同金額或分類的固定支出')
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
    await repository.save(record)
    expenses.value = await repository.list()
    selectedDate.value = record.date
    filter.value = 'ALL'
    showForm.value = false
    showToast(editingId.value ? '支出已更新' : '支出已記錄')
    editingId.value = null
  } catch (error) {
    showToast(error.message)
  }
}

async function togglePaid(occurrence) {
  const source = expenses.value.find((record) => record.id === occurrence.sourceId)
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
  showToast(occurrence.status === 'PAID' ? '已改為預計支付' : '已標記支付')
}

async function removeExpense(expense) {
  const source = expenses.value.find((record) => record.id === expense.sourceId)
  try {
    await showConfirmDialog({
      title: source.frequency === 'NONE' ? '刪除這筆支出？' : '刪除整條固定支出？',
      message:
        source.frequency === 'NONE'
          ? `${expense.date} · ${formatAud(expense.amountCents)}，刪除後無法復原。`
          : '這會刪除所有預計與已付紀錄，且無法復原。',
    })
  } catch {
    return
  }
  await repository.remove(source.id)
  expenses.value = await repository.list()
  showToast('支出已刪除')
}
</script>

<template>
  <section class="expense-page app-page">
    <header class="page-header app-page__header">
      <div>
        <h1>支出紀錄</h1>
        <p>生活花費與固定扣款，一起記清楚。</p>
      </div>
      <van-button
        class="app-page__action header-action"
        type="primary"
        size="small"
        icon="plus"
        @click="openForm()"
        >記一筆支出</van-button
      >
    </header>

    <section class="overview app-page__card" aria-labelledby="expense-overview-title">
      <div class="overview-top">
        <div>
          <h2 id="expense-overview-title">本週支出</h2>
        </div>
        <button type="button" class="today-link" @click="selectCurrentWeek">回本週</button>
      </div>
      <div class="week-switcher" aria-label="切換統計週期">
        <button type="button" aria-label="上一週" @click="moveWeek(-1)">
          <van-icon name="arrow-left" />
        </button>
        <span>{{ weekLabel }} <small>週一至週日</small></span>
        <button type="button" aria-label="下一週" @click="moveWeek(1)">
          <van-icon name="arrow" />
        </button>
      </div>
      <div v-if="summary.count" class="overview-amount">
        <span>已支付</span><strong>{{ formatAud(summary.paidCents) }}</strong
        ><small>本週現金流支出</small>
      </div>
      <div v-if="summary.count" class="overview-bottom">
        <span
          >預計支付 <strong>{{ formatAud(summary.plannedCents) }}</strong></span
        ><span>{{ summary.count }} 筆紀錄</span>
      </div>
      <p v-if="summary.count" class="overview-note">固定支出未標記已付前，只列入預計支付。</p>
      <p v-else class="overview-empty">本週尚無支出，記錄後會區分已支付與預計支付。</p>
    </section>

    <section class="records-section" aria-labelledby="records-title">
      <div class="section-heading">
        <div>
          <h2 id="records-title">支出紀錄</h2>
        </div>
        <small>{{ weeklyExpenses.length }} 筆</small>
      </div>
      <div v-if="activeGroups.length" class="filter-row" aria-label="支出大類篩選">
        <button type="button" :class="{ active: filter === 'ALL' }" @click="filter = 'ALL'">
          全部
        </button>
        <button
          v-for="group in activeGroups"
          :key="group.id"
          type="button"
          :class="{ active: filter === group.id }"
          @click="filter = group.id"
        >
          {{ group.label }}
        </button>
      </div>
      <div v-if="weeklyExpenses.length === 0" class="empty-card">
        <strong>{{ filter === 'ALL' ? '本週還沒有支出' : '這個分類還沒有紀錄' }}</strong>
        <span>開始記錄生活花費或固定扣款。</span>
        <van-button
          v-if="filter === 'ALL'"
          class="app-page__action"
          type="primary"
          size="small"
          @click="openForm()"
          >新增支出</van-button
        >
      </div>
      <article v-for="expense in weeklyExpenses" :key="expense.occurrenceId" class="expense-card">
        <div class="expense-card__main">
          <span class="expense-card__icon"
            ><van-icon :name="getExpenseGroup(expense.group).icon"
          /></span>
          <div class="expense-card__info">
            <strong>{{
              expense.title || getExpenseCategory(expense.group, expense.category).label
            }}</strong
            ><span
              >{{ expense.date }} · {{ getExpenseGroup(expense.group).label }} /
              {{ getExpenseCategory(expense.group, expense.category).label }}</span
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
            >{{ expense.status === 'PAID' ? '已支付' : '預計支付' }}</span
          >
          <span v-if="expense.frequency !== 'NONE'" class="frequency-pill">{{
            EXPENSE_FREQUENCIES.find((item) => item.id === expense.frequency)?.label
          }}</span>
          <span v-if="expense.note" class="expense-card__note">{{ expense.note }}</span>
          <div class="expense-card__actions">
            <button type="button" class="payment-action" @click="togglePaid(expense)">
              {{ expense.status === 'PAID' ? '改待付' : '標記已付' }}
            </button>
            <button type="button" @click="openForm(expense)">編輯</button
            ><button type="button" @click="removeExpense(expense)">刪除</button>
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
        <h2 id="category-title">花在哪裡</h2>
        <small>僅計已支付</small>
      </div>
      <div class="category-breakdown">
        <div v-for="group in summary.byGroup" :key="group.id" class="category-row">
          <span class="category-icon"><van-icon :name="group.icon" /></span>
          <span class="category-name">{{ group.label }}</span>
          <strong>{{ formatAud(group.amountCents) }}</strong>
        </div>
      </div>
    </section>

    <p v-if="summary.investmentLossCents" class="investment-note">
      已記錄投資虧損 {{ formatAud(summary.investmentLossCents) }}；不列入生活支出現金流。
    </p>

    <van-popup v-model:show="showForm" position="bottom" round safe-area-inset-bottom>
      <form class="sheet-form" @submit.prevent="saveExpense">
        <div class="sheet-header">
          <div>
            <h2>{{ editingId ? '編輯支出' : '記一筆支出' }}</h2>
          </div>
          <button type="button" aria-label="關閉" @click="showForm = false">
            <van-icon name="cross" />
          </button>
        </div>
        <div class="sheet-scroll">
          <p class="field-label">支出大類</p>
          <div class="group-picker">
            <button
              v-for="group in EXPENSE_GROUPS"
              :key="group.id"
              type="button"
              :class="{ selected: form.group === group.id }"
              @click="selectGroup(group)"
            >
              <van-icon :name="group.icon" /><span>{{ group.label }}</span>
            </button>
          </div>
          <p class="field-label">支出小類</p>
          <div class="subcategory-picker">
            <button
              v-for="category in selectedGroup.categories"
              :key="category.id"
              type="button"
              :class="{ selected: form.category === category.id }"
              @click="selectCategory(category)"
            >
              {{ category.label }}
            </button>
          </div>
          <p v-if="form.category === 'INVESTMENT_LOSS'" class="form-hint">
            只記錄已實現虧損，這筆不計入生活支出現金流；正收益留待收入／投資功能處理。
          </p>
          <van-cell-group inset class="form-fields">
            <van-field
              v-model="form.amount"
              label="金額 AUD"
              type="number"
              inputmode="decimal"
              placeholder="0.00"
              required
            />
            <van-field v-model="form.date" label="日期" type="date" required />
            <van-field
              v-model="form.title"
              label="商家 / 標題"
              placeholder="選填，例如 Woolworths"
              clearable
            />
            <van-field
              v-model="form.note"
              label="備註"
              type="textarea"
              rows="2"
              autosize
              placeholder="選填"
              clearable
            />
          </van-cell-group>
          <p v-if="form.category !== 'INVESTMENT_LOSS'" class="field-label">支出頻率</p>
          <div v-if="form.category !== 'INVESTMENT_LOSS'" class="frequency-picker">
            <button
              v-for="frequency in EXPENSE_FREQUENCIES"
              :key="frequency.id"
              type="button"
              :class="{ selected: form.frequency === frequency.id }"
              @click="form.frequency = frequency.id"
            >
              {{ frequency.label }}
            </button>
          </div>
          <van-cell-group v-if="form.frequency === 'CUSTOM'" inset class="interval-field"
            ><van-field
              v-model="form.intervalDays"
              label="每隔幾天"
              type="number"
              inputmode="numeric"
              placeholder="1–365"
              required
          /></van-cell-group>
          <van-cell-group v-if="form.frequency !== 'NONE'" inset class="interval-field">
            <van-field
              v-model="form.endDate"
              label="結束日期"
              type="date"
              placeholder="選填，不填表示持續"
              clearable
            />
          </van-cell-group>
          <p v-if="form.frequency !== 'NONE'" class="form-hint">
            從所選日期開始自動排程。未來每次扣款預設待付；列表可逐次標記已付。有已付紀錄後，若要改價請先設定結束日期，再建立新排程。
          </p>
          <p v-if="form.category !== 'INVESTMENT_LOSS'" class="field-label">付款狀態</p>
          <div v-if="form.category !== 'INVESTMENT_LOSS'" class="status-picker">
            <button
              type="button"
              :class="{ selected: form.status === 'PAID' }"
              @click="form.status = 'PAID'"
            >
              已支付</button
            ><button
              type="button"
              :class="{ selected: form.status === 'PLANNED' }"
              @click="form.status = 'PLANNED'"
            >
              預計支付
            </button>
          </div>
          <p v-if="form.category !== 'INVESTMENT_LOSS'" class="status-hint">
            {{
              form.frequency === 'NONE'
                ? '預計支付不會算入本週已支付金額。'
                : '這裡只設定起始那筆；後續每次預設待付。'
            }}
          </p>
        </div>
        <div class="sheet-footer">
          <van-button type="primary" block native-type="submit">{{
            editingId ? '儲存變更' : '儲存支出'
          }}</van-button>
        </div>
      </form>
    </van-popup>
  </section>
</template>

<style scoped>
.expense-page {
  width: 100%;
  color: #1b2a3b;
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
  border: 1px solid #e6edf5;
  background: #f8fafc;
  text-align: center;
}
.week-switcher button {
  width: 42px;
  height: 42px;
  border: 0;
  background: transparent;
  color: #345474;
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
  color: #8290a0;
  font-weight: 400;
}
.overview-amount {
  display: flex;
  flex-direction: column;
  padding: 12px 3px 10px;
}
.overview-amount span {
  color: #657588;
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
  border-top: 1px solid #edf1f5;
  color: #657588;
  font-size: 12px;
}
.overview-bottom strong {
  margin-left: 5px;
  color: #1b2a3b;
  font-size: 14px;
}
.overview-note {
  margin: 8px 0 0;
  color: #8290a0;
  font-size: 12px;
}
.overview-empty {
  margin: 10px 2px 0;
  color: #657588;
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
  color: #8290a0;
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
  border: 1px solid #e6edf5;
  border-radius: 20px;
  background: #fff;
}
.category-row {
  gap: 12px;
  min-height: 52px;
  border-bottom: 1px solid #edf1f5;
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
  border: 1px solid #e6edf5;
  border-radius: 999px;
  padding: 8px 14px;
  background: #fff;
  color: #657588;
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
  color: #8290a0;
  font-size: 12px;
  line-height: 1.5;
}
.expense-card {
  margin: 0 0 10px;
  padding: 16px;
  border: 1px solid #e6edf5;
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
  color: #8290a0;
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
  border-top: 1px solid #edf1f5;
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
  color: #8290a0;
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
  color: #345474;
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
  color: #345474;
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
  border: 1px solid #e6edf5;
  border-radius: 12px;
  background: #fff;
  color: #657588;
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
  border: 1px solid #e6edf5;
  border-radius: 11px;
  background: #fff;
  color: #657588;
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
  color: #657588;
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
  border: 1px solid #e6edf5;
  border-radius: 11px;
  background: #fff;
  color: #657588;
  font-weight: 700;
}
.status-picker button.selected {
  border-color: #1976d2;
  background: #eaf3fe;
  color: #166dd1;
}
.status-hint {
  margin: 9px 4px 0;
  color: #8290a0;
  font-size: 11px;
}
.sheet-footer {
  flex: none;
  padding: 12px 16px 14px;
  border-top: 1px solid #e6edf5;
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

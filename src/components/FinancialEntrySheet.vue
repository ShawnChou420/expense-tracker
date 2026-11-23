<script setup>
// 通用手動交易表單：一般收入、外幣單次支出、資金移轉（financial_entry）。
// 計算與驗證在 domain/finances.js、domain/fx.js；AUD 支出仍走支出頁。
import { computed, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useI18n } from 'vue-i18n'
import { expenseCategoryLabel, incomeCategoryLabel } from '../i18n/labels.js'
import { formatLocalDate } from '../domain/date.js'
import {
  createFinancialEntry,
  ENTRY_TYPES,
  getForeignExpenseCategories,
  INCOME_CATEGORIES,
} from '../domain/finances.js'
import {
  convertToAudCents,
  FX_SOURCES,
  minorToMajor,
  normalizeFxRate,
  rateFromAudRates,
  toMinorUnits,
  TRANSACTION_CURRENCIES,
} from '../domain/fx.js'
import { formatAud } from '../domain/money.js'
import { financialEntryRepository } from '../repositories/appRepositories.js'

const props = defineProps({
  show: { type: Boolean, default: false },
  /** 要編輯的紀錄；null 為新增 */
  entry: { type: Object, default: null },
  /** 新增時的預設類型 */
  defaultType: { type: String, default: 'INCOME' },
  /** 新增時的預設日期（例如從日曆某一天新增）；空白為今天 */
  defaultDate: { type: String, default: '' },
  /** 顯示幣別匯率表：1 AUD = rates[code] */
  exchangeRates: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:show', 'saved'])
const { t } = useI18n()

const today = () => formatLocalDate(new Date())
const form = ref(emptyForm())
const amountInput = ref(null)
const saving = ref(false)

function emptyForm(type = 'INCOME') {
  return {
    id: '',
    type,
    currency: type === 'EXPENSE' ? 'TWD' : 'AUD',
    amount: '',
    category: type === 'INCOME' ? 'SIDE_JOB' : type === 'TRANSFER' ? 'TRANSFER' : 'GROCERIES',
    date: today(),
    status: 'SETTLED',
    title: '',
    note: '',
    fxRate: '',
    fxRateDate: '',
    fxSource: '',
    createdAt: undefined,
  }
}

watch(
  () => props.show,
  (open) => {
    if (!open) return
    const entry = props.entry
    form.value = entry
      ? {
          ...emptyForm(entry.type),
          ...entry,
          amount: String(minorToMajor(entry.amountMinor, entry.currency)),
          fxRate: entry.fxRate || '',
          fxRateDate: entry.fxRateDate || '',
          fxSource: entry.fxSource || '',
        }
      : { ...emptyForm(props.defaultType), date: props.defaultDate || today() }
    if (!entry && form.value.currency !== 'AUD') useTodayRate(true)
  },
  { immediate: true },
)

const types = computed(() => [
  { id: ENTRY_TYPES.INCOME, label: t('finances.typeIncome') },
  { id: ENTRY_TYPES.EXPENSE, label: t('finances.typeExpense') },
  { id: ENTRY_TYPES.TRANSFER, label: t('finances.typeTransfer') },
])
const currencies = computed(() =>
  TRANSACTION_CURRENCIES.filter(
    (currency) => form.value.type !== ENTRY_TYPES.EXPENSE || currency.code !== 'AUD',
  ),
)
const categories = computed(() =>
  form.value.type === ENTRY_TYPES.INCOME
    ? INCOME_CATEGORIES.map((item) => ({
        id: item.id,
        label: incomeCategoryLabel(item.id, item.label),
      }))
    : form.value.type === ENTRY_TYPES.EXPENSE
      ? getForeignExpenseCategories().map((item) => ({
          id: item.id,
          label: expenseCategoryLabel(item.id, item.label),
        }))
      : [],
)

function selectType(type) {
  if (form.value.type === type) return
  const next = emptyForm(type)
  form.value = { ...next, id: form.value.id, amount: form.value.amount, date: form.value.date }
  if (type !== ENTRY_TYPES.EXPENSE && form.value.currency === 'AUD') clearRate()
}
function selectCurrency(code) {
  form.value.currency = code
  clearRate()
  if (code !== 'AUD') useTodayRate(true)
}
function clearRate() {
  form.value.fxRate = ''
  form.value.fxRateDate = ''
  form.value.fxSource = ''
}

const autoRate = computed(() => rateFromAudRates(form.value.currency, props.exchangeRates))
/** @param {boolean} [silent] 切換幣別時自動帶入；取不到匯率時不提示 */
function useTodayRate(silent = false) {
  if (!autoRate.value) {
    if (!silent) showToast(t('finances.fxUnavailable'))
    return
  }
  form.value.fxRate = autoRate.value
  form.value.fxRateDate = today()
  form.value.fxSource = FX_SOURCES.OPEN_ER_API
}
function onRateInput() {
  // 手動修改匯率 → 來源改為手動、日期為交易日
  form.value.fxSource = FX_SOURCES.MANUAL
  form.value.fxRateDate = form.value.date
}

const amountMinor = computed(() => toMinorUnits(form.value.amount, form.value.currency))
const rateInvalid = computed(
  () => form.value.currency !== 'AUD' && form.value.fxRate !== '' && !normalizeFxRate(form.value.fxRate),
)
const convertedPreview = computed(() => {
  if (form.value.currency === 'AUD' || !amountMinor.value) return ''
  const cents = convertToAudCents(amountMinor.value, form.value.fxRate)
  return cents === null ? '' : t('finances.fxConverted', { amount: formatAud(cents) })
})
const statusOptions = computed(() => [
  {
    id: 'SETTLED',
    label: form.value.type === ENTRY_TYPES.EXPENSE ? t('finances.statusPaid') : t('finances.statusSettled'),
  },
  { id: 'PLANNED', label: t('finances.statusPlanned') },
])
const hint = computed(() => {
  if (form.value.type === ENTRY_TYPES.TRANSFER) return t('finances.transferHint')
  if (form.value.type === ENTRY_TYPES.EXPENSE) return t('finances.foreignExpenseHint')
  if (form.value.category === 'INVESTMENT_GAIN') return t('finances.investmentGainHint')
  if (form.value.category === 'REFUND') return t('finances.refundHint')
  return t('finances.incomeHint')
})
const currencySymbol = computed(
  () => TRANSACTION_CURRENCIES.find((item) => item.code === form.value.currency)?.symbol ?? '',
)

function close() {
  emit('update:show', false)
}

async function save() {
  if (saving.value) return
  if (rateInvalid.value) {
    showToast(t('finances.errors.fxRate'))
    return
  }
  let entry
  try {
    entry = createFinancialEntry({
      ...form.value,
      id: form.value.id || undefined,
      amountMinor: amountMinor.value,
      status: form.value.type === ENTRY_TYPES.TRANSFER ? 'SETTLED' : form.value.status,
    })
  } catch (error) {
    showToast(t(/** @type {Error} */ (error).message))
    return
  }
  saving.value = true
  try {
    const saved = await financialEntryRepository.save(entry)
    showToast(t('finances.saved'))
    emit('saved', saved)
    close()
  } catch (error) {
    showToast(/** @type {Error} */ (error).message)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!form.value.id) return
  try {
    await showConfirmDialog({ message: t('finances.deleteConfirm') })
  } catch {
    return
  }
  try {
    await financialEntryRepository.remove(form.value.id)
    showToast(t('finances.deleted'))
    emit('saved', null)
    close()
  } catch (error) {
    showToast(/** @type {Error} */ (error).message)
  }
}

function focusAmount() {
  if (!props.entry) amountInput.value?.focus()
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    safe-area-inset-bottom
    @update:show="emit('update:show', $event)"
    @opened="focusAmount"
  >
    <form class="entry-sheet" data-testid="financial-entry-sheet" @submit.prevent="save">
      <div class="entry-sheet__header">
        <h2>{{ entry ? t('finances.editEntry') : t('finances.addEntry') }}</h2>
        <button type="button" :aria-label="t('common.close')" @click="close">
          <van-icon name="cross" />
        </button>
      </div>
      <div class="entry-sheet__scroll">
        <div class="segmented" role="group" :aria-label="t('finances.typeAria')">
          <button
            v-for="type in types"
            :key="type.id"
            type="button"
            :class="{ selected: form.type === type.id }"
            :aria-pressed="form.type === type.id"
            @click="selectType(type.id)"
          >
            {{ type.label }}
          </button>
        </div>

        <div class="currency-row" role="group" :aria-label="t('finances.currencyAria')">
          <button
            v-for="currency in currencies"
            :key="currency.code"
            type="button"
            :class="{ selected: form.currency === currency.code }"
            :aria-pressed="form.currency === currency.code"
            @click="selectCurrency(currency.code)"
          >
            {{ currency.code }}
          </button>
        </div>
        <label class="amount-hero">
          <span class="amount-hero__currency">{{ form.currency }} {{ currencySymbol }}</span>
          <input
            ref="amountInput"
            v-model="form.amount"
            class="amount-hero__input"
            type="text"
            inputmode="decimal"
            enterkeyhint="done"
            placeholder="0.00"
            :aria-label="t('finances.amountAria')"
            autocomplete="off"
          />
        </label>

        <div v-if="form.currency !== 'AUD'" class="fx-box">
          <div class="fx-box__row">
            <label class="fx-box__label" for="entry-fx-rate">{{
              t('finances.fxRateLabel', { currency: form.currency })
            }}</label>
            <button type="button" class="fx-box__auto" @click="useTodayRate()">
              {{ t('finances.useTodayRate') }}
            </button>
          </div>
          <input
            id="entry-fx-rate"
            v-model="form.fxRate"
            class="fx-box__input"
            :class="{ invalid: rateInvalid }"
            type="text"
            inputmode="decimal"
            :placeholder="t('finances.fxRate')"
            autocomplete="off"
            @input="onRateInput"
          />
          <p v-if="convertedPreview" class="fx-box__preview">{{ convertedPreview }}</p>
          <p v-else class="fx-box__hint">{{ t('finances.fxNoRate') }}</p>
          <p
            v-if="form.fxSource === 'OPEN_ER_API' && form.fxRateDate && form.fxRateDate !== form.date"
            class="fx-box__hint"
          >
            {{ t('finances.fxAutoDate', { date: form.fxRateDate }) }}
          </p>
        </div>

        <template v-if="categories.length">
          <p class="field-label">{{ t('finances.category') }}</p>
          <div class="chips">
            <button
              v-for="category in categories"
              :key="category.id"
              type="button"
              :class="{ selected: form.category === category.id }"
              :aria-pressed="form.category === category.id"
              @click="form.category = category.id"
            >
              {{ category.label }}
            </button>
          </div>
        </template>
        <p class="form-hint">{{ hint }}</p>

        <template v-if="form.type !== 'TRANSFER'">
          <div class="segmented segmented--two" role="group" :aria-label="t('finances.statusAria')">
            <button
              v-for="status in statusOptions"
              :key="status.id"
              type="button"
              :class="{ selected: form.status === status.id }"
              :aria-pressed="form.status === status.id"
              @click="form.status = status.id"
            >
              {{ status.label }}
            </button>
          </div>
        </template>

        <van-cell-group inset class="form-fields">
          <van-field v-model="form.date" :label="t('common.date')" type="date" required />
          <van-field
            v-model="form.title"
            :label="t('finances.titleLabel')"
            :placeholder="t('finances.titlePlaceholder')"
            maxlength="120"
            clearable
          />
          <van-field
            v-model="form.note"
            :label="t('common.note')"
            type="textarea"
            rows="2"
            autosize
            maxlength="500"
            :placeholder="t('common.optional')"
          />
        </van-cell-group>
      </div>
      <div class="entry-sheet__footer">
        <van-button v-if="entry" plain type="danger" native-type="button" @click="remove">
          {{ t('common.delete') }}
        </van-button>
        <van-button type="primary" block native-type="submit" :loading="saving">
          {{ t('finances.save') }}
        </van-button>
      </div>
    </form>
  </van-popup>
</template>

<style scoped>
.entry-sheet {
  display: flex;
  flex-direction: column;
  max-height: min(88dvh, 760px);
  background: var(--color-background-soft, #f5f7fa);
}
.entry-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 19px 20px 12px;
}
.entry-sheet__header h2 {
  margin: 0;
  font-size: 21px;
}
.entry-sheet__header button {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-heading);
}
.entry-sheet__scroll {
  overflow: auto;
  padding: 0 16px 22px;
  overscroll-behavior: contain;
}
.segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 12px;
  padding: 4px;
  border-radius: 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}
.segmented--two {
  grid-template-columns: 1fr 1fr;
  margin-top: 14px;
}
.segmented button {
  min-height: 40px;
  min-width: 0;
  padding: 0 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--color-muted);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.segmented button.selected {
  background: var(--color-primary);
  color: #fff;
}
.currency-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.currency-row button,
.chips button {
  min-height: var(--touch-target, 44px);
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-heading);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.currency-row button.selected,
.chips button.selected {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.amount-hero {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 4px 0 12px;
  padding: 14px 16px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-medium, 14px);
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
.fx-box {
  margin-bottom: 4px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium, 14px);
  background: var(--color-surface);
}
.fx-box__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.fx-box__label {
  color: var(--color-heading);
  font-size: 13px;
  font-weight: 800;
}
.fx-box__auto {
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
.fx-box__input {
  box-sizing: border-box;
  width: 100%;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: transparent;
  color: var(--color-heading);
  font: inherit;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.fx-box__input.invalid {
  border-color: #d93c3c;
}
.fx-box__preview {
  margin: 8px 0 0;
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 800;
}
.fx-box__hint,
.form-hint {
  margin: 8px 2px 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}
.field-label {
  margin: 16px 4px 10px;
  font-size: 13px;
  font-weight: 800;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.form-fields {
  margin: 16px 0 0;
}
.entry-sheet__footer {
  display: flex;
  gap: 10px;
  flex: none;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.entry-sheet__footer .van-button {
  height: 48px;
  border-radius: 12px;
  font-weight: 800;
}
.entry-sheet__footer .van-button--danger {
  flex: none;
  width: 96px;
}
</style>

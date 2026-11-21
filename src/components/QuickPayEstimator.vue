<script setup>
// 訪客首頁：雙滑桿快速試算（時薪 × 每週工時）。只是 UI 試算狀態，不寫入任何正式設定或班表。
import { computed, onMounted, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { joinList } from '../i18n/format.js'
import { getMinimumWage } from '../domain/minimumWage.js'
import {
  QUICK_ESTIMATE_EXCLUDES,
  QUICK_HOURS,
  QUICK_RATE,
  formatQuickHours,
  parseQuickHours,
  parseQuickRate,
  quickGrossCents,
} from '../domain/quickEstimate.js'
import { formatLocalDate } from '../domain/date.js'

const emit = defineEmits(['start', 'import-payslip', 'open-account'])
const { t } = useI18n()
// 與 QUICK_ESTIMATE_EXCLUDES 同順序的翻譯 key
const EXCLUDE_KEYS = ['casualLoading', 'nightLoading', 'weekendHoliday', 'overtime', 'smoko', 'allowances', 'payg']
const excludesText = computed(() =>
  joinList(QUICK_ESTIMATE_EXCLUDES.map((label, index) => (EXCLUDE_KEYS[index] ? t(`guest.excludes.${EXCLUDE_KEYS[index]}`) : label))),
)

const wage = getMinimumWage(formatLocalDate(new Date()))
// 以整數保存：時薪 cents、工時 1/100 小時，滑桿與輸入框共用同一個值，不會被四捨五入成整數
const quickRateCents = ref(wage.hourlyCents)
const quickHoursHundredths = ref(QUICK_HOURS.defaultHundredths)
const quickGrossPayCents = computed(() => quickGrossCents(quickRateCents.value, quickHoursHundredths.value))

const rateText = ref(formatRate(quickRateCents.value))
const hoursText = ref(formatQuickHours(quickHoursHundredths.value))
const rateError = ref(false)
const hoursError = ref(false)

function formatRate(/** @type {number} */ cents) {
  return (cents / 100).toFixed(2)
}
function formatMoney(/** @type {number} */ cents) {
  return `A$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function onRateSlide(/** @type {number} */ value) {
  quickRateCents.value = value
  rateText.value = formatRate(value)
  rateError.value = false
}
function onHoursSlide(/** @type {number} */ value) {
  quickHoursHundredths.value = value
  hoursText.value = formatQuickHours(value)
  hoursError.value = false
}
function commitRate() {
  const cents = parseQuickRate(rateText.value)
  rateError.value = cents === null
  if (cents === null) return
  quickRateCents.value = cents
  rateText.value = formatRate(cents)
}
function commitHours() {
  const hundredths = parseQuickHours(hoursText.value)
  hoursError.value = hundredths === null
  if (hundredths === null) return
  quickHoursHundredths.value = hundredths
  hoursText.value = formatQuickHours(hundredths)
}
function blurOnEnter(/** @type {KeyboardEvent} */ event) {
  if (event.key === 'Enter') /** @type {HTMLInputElement} */ (event.target).blur()
}
function reset() {
  onRateSlide(wage.hourlyCents)
  onHoursSlide(QUICK_HOURS.defaultHundredths)
}
const isDefault = computed(
  () => quickRateCents.value === wage.hourlyCents && quickHoursHundredths.value === QUICK_HOURS.defaultHundredths,
)
// 無障礙：Vant 滑桿的 aria-valuenow 是內部整數（2644），補上名稱與易讀的值
const rateSlider = ref(/** @type {{ $el?: HTMLElement } | null} */ (null))
const hoursSlider = ref(/** @type {{ $el?: HTMLElement } | null} */ (null))
function labelSlider(
  /** @type {{ $el?: HTMLElement } | null} */ slider,
  /** @type {string} */ label,
  /** @type {string} */ valueText,
) {
  const handle = slider?.$el?.querySelector?.('[role="slider"]')
  if (!handle) return
  handle.setAttribute('aria-label', label)
  handle.setAttribute('aria-valuetext', valueText)
}
onMounted(() =>
  watchEffect(() => {
    labelSlider(rateSlider.value, t('guest.hourlyRate'), t('guest.rateAria', { rate: `$${formatRate(quickRateCents.value)}` }))
    labelSlider(hoursSlider.value, t('guest.hoursPerWeek'), t('guest.hoursAria', { hours: formatQuickHours(quickHoursHundredths.value) }))
  }),
)
const effectiveLabel = wage.effectiveDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1/$2/$3')
</script>

<template>
  <section class="quick-pay" aria-labelledby="quick-pay-title">
    <h1 id="quick-pay-title" class="quick-pay__title">{{ t('guest.title') }}</h1>
    <p class="quick-pay__lede">{{ t('guest.subtitle') }}</p>

    <div class="quick-pay__card">
      <div class="quick-pay__field">
        <div class="quick-pay__row">
          <label for="quick-rate" class="quick-pay__label">{{ t('guest.hourlyRate') }}</label>
          <span class="quick-pay__value">
            A$<input
              id="quick-rate"
              v-model="rateText"
              class="quick-pay__input"
              :class="{ 'is-error': rateError }"
              :style="{ width: `${Math.max(rateText.length, 2) + 1}ch` }"
              inputmode="decimal"
              autocomplete="off"
              enterkeyhint="done"
              aria-describedby="quick-rate-hint"
              @blur="commitRate"
              @keydown="blurOnEnter"
            /><small>{{ t('guest.perHour') }}</small>
          </span>
        </div>
        <van-slider
          ref="rateSlider"
          :model-value="quickRateCents"
          :min="QUICK_RATE.minCents"
          :max="QUICK_RATE.maxCents"
          :step="QUICK_RATE.stepCents"
          bar-height="6px"
          button-size="26px"
          @update:model-value="onRateSlide"
        />
        <p id="quick-rate-hint" class="quick-pay__hint" :class="{ 'is-error': rateError }">
          {{ rateError ? t('guest.rateError') : t('guest.rateHint') }}
        </p>
      </div>

      <div class="quick-pay__field">
        <div class="quick-pay__row">
          <label for="quick-hours" class="quick-pay__label">{{ t('guest.hoursPerWeek') }}</label>
          <span class="quick-pay__value">
            <input
              id="quick-hours"
              v-model="hoursText"
              class="quick-pay__input"
              :class="{ 'is-error': hoursError }"
              :style="{ width: `${Math.max(hoursText.length, 2) + 1}ch` }"
              inputmode="decimal"
              autocomplete="off"
              enterkeyhint="done"
              aria-describedby="quick-hours-hint"
              @blur="commitHours"
              @keydown="blurOnEnter"
            /><small>{{ t('guest.hoursUnit') }}</small>
          </span>
        </div>
        <van-slider
          ref="hoursSlider"
          :model-value="quickHoursHundredths"
          :min="QUICK_HOURS.min"
          :max="QUICK_HOURS.max"
          :step="QUICK_HOURS.step"
          bar-height="6px"
          button-size="26px"
          @update:model-value="onHoursSlide"
        />
        <p id="quick-hours-hint" class="quick-pay__hint" :class="{ 'is-error': hoursError }">
          {{ hoursError ? t('guest.hoursError') : t('guest.hoursHint') }}
        </p>
      </div>

      <div class="quick-pay__result" aria-live="polite">
        <span class="quick-pay__result-label">{{ t('guest.estimatedGross') }}</span>
        <strong class="quick-pay__amount">{{ formatMoney(quickGrossPayCents) }}</strong>
        <button v-if="!isDefault" type="button" class="quick-pay__reset" @click="reset">{{ t('common.reset') }}</button>
      </div>
      <p class="quick-pay__fine">
        {{ t('guest.estimateFine', { items: excludesText }) }}
      </p>
      <p class="quick-pay__fine">
        {{ t('guest.minimumWageFine', { rate: `$${formatRate(wage.hourlyCents)}`, date: effectiveLabel, basis: t('guest.minimumWageBasis') }) }}
        <a :href="wage.sourceUrl" target="_blank" rel="noopener">Fair Work</a>。
      </p>
    </div>

    <van-button type="primary" block round class="quick-pay__start" @click="emit('start')">
      {{ t('guest.startScheduling') }}
    </van-button>
    <button type="button" class="quick-pay__link" @click="emit('import-payslip')">
      {{ t('guest.importPayslip') }}
    </button>
    <p class="quick-pay__account">
      {{ t('guest.savePrompt') }}
      <button type="button" class="quick-pay__link quick-pay__link--inline" @click="emit('open-account')">
        {{ t('guest.signUpFree') }}
      </button>
    </p>
  </section>
</template>

<style scoped>
.quick-pay {
  display: grid;
  gap: var(--space-row);
}
.quick-pay__title {
  margin: 0;
  color: var(--color-heading);
  font-size: var(--font-title);
  line-height: 1.3;
  text-wrap: balance;
}
.quick-pay__lede {
  margin: -4px 0 0;
  color: var(--color-muted);
  font-size: var(--font-body);
}
.quick-pay__card {
  display: grid;
  gap: 18px;
  padding: 18px 16px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-large);
  background: var(--color-surface);
}
.quick-pay__field {
  display: grid;
  gap: 12px;
}
.quick-pay__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.quick-pay__label {
  color: var(--color-heading);
  font-size: 15px;
  font-weight: 700;
}
.quick-pay__value {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  color: var(--color-heading);
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.quick-pay__value small {
  margin-left: 4px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 600;
}
.quick-pay__input {
  min-width: 3ch;
  padding: 2px 4px;
  border: 0;
  border-bottom: 2px dashed var(--color-border);
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.quick-pay__input:focus {
  border-bottom-color: var(--color-primary);
  outline: none;
}
.quick-pay__input.is-error {
  border-bottom-color: var(--color-expense);
}
.quick-pay__hint {
  margin: -4px 0 0;
  color: var(--color-muted);
  font-size: 12px;
}
.quick-pay__hint.is-error {
  color: var(--color-expense);
  font-weight: 700;
}
.quick-pay__field :deep(.van-slider) {
  margin: 6px 13px;
}
.quick-pay__result {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
}
.quick-pay__result-label {
  flex-basis: 100%;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}
.quick-pay__amount {
  color: var(--color-income);
  font-size: clamp(30px, 9vw, 38px);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.quick-pay__reset {
  margin-left: auto;
  min-height: var(--touch-target);
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.quick-pay__fine {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}
.quick-pay__fine a {
  color: var(--color-primary);
}
.quick-pay__start {
  margin-top: 4px;
  height: var(--page-button-height);
  font-size: 16px;
  font-weight: 700;
}
.quick-pay__link {
  min-height: var(--touch-target);
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.quick-pay__link--inline {
  min-height: 0;
  padding: 0;
}
.quick-pay__account {
  margin: 0;
  color: var(--color-muted);
  font-size: 14px;
  text-align: center;
}
</style>

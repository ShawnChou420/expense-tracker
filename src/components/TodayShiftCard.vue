<script setup>
// 首頁「今日工作」：正在上班／今天稍後／今天剛下班／下一班／休息。
// 金額直接用班表上已算好的稅前薪資（useShiftCalculator），不在這裡重新計薪。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getFocusShift } from '../domain/today.js'
import { describeStart, formatDateLabel, formatDuration } from '../i18n/format.js'

const props = defineProps({
  records: { type: Array, required: true },
  now: { type: Date, required: true },
  // 工作設定是否已有費率；沒有就不顯示金額，避免用預設費率算出不真實的薪資
  payReady: Boolean,
  money: { type: Function, required: true },
  currency: { type: String, default: 'AUD' },
})
const emit = defineEmits(['open-payroll', 'import-payslip', 'work-setup', 'add-shift', 'adjust-shift'])

const { t } = useI18n()
const focus = computed(() => getFocusShift(props.records, props.now))
const shift = computed(() => focus.value.shift)

const title = computed(() => {
  const night = shift.value?.crossesMidnight
  switch (focus.value.kind) {
    case 'current':
      return night ? t('shiftCard.nightInProgress') : t('shiftCard.working')
    case 'later-today':
      return night ? t('dashboard.nightShift') : t('dashboard.todayShift')
    case 'finished':
      return t('shiftCard.finished')
    case 'leave':
      return t('shiftCard.onLeave')
    case 'next':
      return t('shiftCard.offToday')
    default:
      return t('shiftCard.offToday')
  }
})

const status = computed(() => {
  const value = shift.value
  if (!value) return ''
  if (focus.value.kind === 'current') {
    const left = Math.max(0, Math.round((value.end.getTime() - props.now.getTime()) / 60000))
    return t('shiftCard.timeLeft', { duration: formatDuration(left) })
  }
  if (focus.value.kind === 'finished') return t('shiftCard.wellDone')
  return describeStart(value, props.now)
})

/** 只有今天相關的班才放大顯示；「下一班」縮成一行提示 */
const showDetail = computed(() => ['current', 'later-today', 'finished'].includes(focus.value.kind))
const shiftLabel = computed(() =>
  shift.value
    ? `${shift.value.startTime} → ${shift.value.endTime}${shift.value.crossesMidnight ? t('shiftCard.nextDay') : ''}`
    : '',
)
const restMessage = computed(() =>
  focus.value.kind === 'leave' ? t('shiftCard.leaveMessage') : t('shiftCard.restMessage'),
)
</script>

<template>
  <section
    class="today-shift app-page__card"
    :class="{ 'today-shift--active': focus.kind === 'current' }"
    aria-labelledby="today-shift-title"
  >
    <div class="today-shift__head">
      <span class="today-shift__icon" aria-hidden="true">
        <van-icon :name="showDetail ? 'clock-o' : 'smile-o'" />
      </span>
      <div class="today-shift__titles">
        <h2 id="today-shift-title">{{ title }}</h2>
        <p v-if="showDetail">{{ formatDateLabel(shift.workDate) }} · {{ status }}</p>
        <p v-else>{{ restMessage }}</p>
      </div>
      <span v-if="focus.kind === 'current'" class="today-shift__live">{{ t('dashboard.onShift') }}</span>
    </div>

    <template v-if="showDetail">
      <button type="button" class="today-shift__body" @click="emit('open-payroll')">
        <strong class="today-shift__time">{{ shiftLabel }}</strong>
        <span class="today-shift__meta">
          {{ t('shiftCard.paidTime', { duration: formatDuration(shift.paidMinutes) }) }}
          <template v-if="shift.smokoDeductMinutes > 0">
            {{ t('shiftCard.smokoDeducted', { duration: formatDuration(shift.smokoDeductMinutes) }) }}
          </template>
        </span>
        <span v-if="payReady" class="today-shift__pay">
          <small>{{ t('shiftCard.estimatedGross') }}</small>
          <strong>{{ currency }} {{ money(shift.grossCents) }}</strong>
        </span>
      </button>
      <van-button
        class="today-shift__adjust"
        size="small"
        plain
        type="primary"
        icon="underway-o"
        block
        @click="emit('adjust-shift', shift.workDate)"
      >
        {{ t('shiftCard.adjustTimes') }}
      </van-button>
      <div v-if="!payReady" class="today-shift__setup" role="note">
        <p>{{ t('shiftCard.noRates') }}</p>
        <div>
          <van-button size="small" type="primary" @click="emit('import-payslip')">{{ t('shiftCard.uploadPayslip') }}</van-button>
          <van-button size="small" plain type="primary" @click="emit('work-setup')">{{ t('shiftCard.manualSetup') }}</van-button>
        </div>
      </div>
    </template>

    <button
      v-if="!showDetail && shift"
      type="button"
      class="today-shift__next"
      @click="emit('open-payroll')"
    >
      <span>{{ t('shiftCard.next', { when: describeStart(shift, now) }) }}</span>
      <van-icon name="arrow" aria-hidden="true" />
    </button>
    <van-button
      v-if="!showDetail && shift"
      class="today-shift__adjust"
      size="small"
      plain
      type="primary"
      icon="underway-o"
      block
      @click="emit('adjust-shift', shift.workDate)"
    >
      {{ t('shiftCard.adjustNext') }}
    </van-button>
    <button
      v-else-if="!showDetail"
      type="button"
      class="today-shift__next"
      @click="emit('add-shift')"
    >
      <span>{{ t('shiftCard.noUpcoming') }}</span>
      <van-icon name="arrow" aria-hidden="true" />
    </button>
  </section>
</template>

<style scoped>
.today-shift__adjust {
  min-height: var(--touch-target);
  border-radius: 12px;
}
.today-shift {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  padding: 16px;
}
.today-shift--active {
  border: 1px solid #b9d3f5;
  background: linear-gradient(180deg, #f4f9ff, #fff 70%);
}
.today-shift__head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.today-shift__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 20px;
}
.today-shift__titles {
  flex: 1;
  min-width: 0;
}
.today-shift__titles h2 {
  margin: 0;
  color: var(--color-heading);
  font-size: 17px;
  font-weight: 800;
}
.today-shift__titles p {
  margin: 2px 0 0;
  color: var(--color-muted);
  font-size: 13px;
}
.today-shift__live {
  flex: none;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-income-soft);
  color: var(--color-income);
  font-size: 12px;
  font-weight: 800;
}
.today-shift__body {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  border: 0;
  border-radius: var(--radius-medium);
  background: var(--color-background);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.today-shift__time {
  color: var(--color-heading);
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.today-shift__meta {
  color: var(--color-muted);
  font-size: 13px;
}
.today-shift__pay {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}
.today-shift__pay small {
  color: var(--color-muted);
  font-size: 13px;
}
.today-shift__pay strong {
  color: var(--color-primary);
  font-size: 18px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.today-shift__setup {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-medium);
  background: var(--color-pending-soft);
}
.today-shift__setup p {
  margin: 0;
  color: var(--color-pending);
  font-size: 13px;
  line-height: 1.5;
}
.today-shift__setup div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.today-shift__next {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: var(--touch-target);
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
</style>

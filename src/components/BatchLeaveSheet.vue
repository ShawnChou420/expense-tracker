<script setup>
// 請假（單日或一段期間）：選日期區間與請假類型。已有實際工作的日期列為衝突，由使用者決定略過或改成請假。
import { computed, ref, watch } from 'vue'
import { showToast } from 'vant'
import { useI18n } from 'vue-i18n'
import { formatDateLabel } from '../i18n/format.js'
import { leaveTypeLabel } from '../i18n/labels.js'
import { LEAVE_TYPES, planBatchLeave } from '../domain/leaveTypes.js'
import { addDays, daysBetweenInclusive } from '../domain/visaJourney.js'
import { formatLocalDate, parseLocalDate } from '../domain/date.js'

const { t, locale } = useI18n()
const props = defineProps({
  show: Boolean,
  records: { type: Array, required: true },
  /** 預設的開始／結束日期（通常是日曆上選取的那天） */
  defaultDate: { type: String, required: true },
})
const emit = defineEmits(['update:show', 'apply'])

const MAX_DAYS = 62
const start = ref('')
const end = ref('')
const leaveType = ref('HOLIDAY')
const conflictMode = ref('SKIP')
// 日曆重新開啟時重設選取狀態
const calendarKey = ref(0)
const calendarOpen = ref(false)

watch(
  () => props.show,
  (show) => {
    if (!show) return
    start.value = props.defaultDate
    end.value = props.defaultDate
    leaveType.value = 'HOLIDAY'
    conflictMode.value = 'SKIP'
    calendarOpen.value = false
  },
  { immediate: true },
)

// 日曆：點開始日、再點結束日（同一天點兩次＝單日）
const calendarDefault = computed(() => {
  const date = parseLocalDate(props.defaultDate) ?? new Date()
  return [date, date]
})
const calendarMin = computed(() => {
  const date = parseLocalDate(props.defaultDate) ?? new Date()
  return new Date(date.getFullYear() - 1, date.getMonth(), 1)
})
const calendarMax = computed(() => {
  const date = parseLocalDate(props.defaultDate) ?? new Date()
  return new Date(date.getFullYear() + 1, date.getMonth() + 1, 0)
})
function onCalendarConfirm(value) {
  const [first, second] = Array.isArray(value) ? value : [value]
  start.value = first ? formatLocalDate(first) : ''
  end.value = second ? formatLocalDate(second) : start.value
  calendarOpen.value = false
}
const rangeLabel = computed(() => {
  void locale.value
  const label = (/** @type {string} */ text) => (parseLocalDate(text) ? formatDateLabel(text) : '')
  if (!start.value) return ''
  const days = daysBetweenInclusive(start.value, end.value)
  return start.value === end.value
    ? t('leaveSheet.oneDay', { date: label(start.value) })
    : t('leaveSheet.manyDays', { start: label(start.value), end: label(end.value), days })
})

const rangeError = computed(() => {
  if (!start.value || !end.value) return t('leaveSheet.chooseDates')
  if (end.value < start.value) return t('leaveSheet.endBeforeStart')
  if (daysBetweenInclusive(start.value, end.value) > MAX_DAYS) return t('leaveSheet.maxDays', { max: MAX_DAYS })
  return ''
})
const dates = computed(() => {
  if (rangeError.value) return []
  const list = []
  for (let date = start.value; date <= end.value; date = addDays(date, 1)) list.push(date)
  return list
})
const plan = computed(() => planBatchLeave(props.records, dates.value))

function apply() {
  if (rangeError.value) return showToast(rangeError.value)
  const changed =
    plan.value.create.length +
    plan.value.updateLeave.length +
    (conflictMode.value === 'REPLACE' ? plan.value.conflicts.length : 0)
  if (!changed) return showToast(t('leaveSheet.noChange'))
  emit('apply', {
    dates: dates.value,
    leaveType: leaveType.value,
    conflictMode: conflictMode.value,
  })
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    closeable
    safe-area-inset-bottom
    class="leave-sheet"
    @update:show="emit('update:show', $event)"
  >
    <div class="leave-sheet__body">
      <h2>{{ t('leaveSheet.title') }}</h2>
      <button type="button" class="leave-range" @click="calendarOpen = true">
        <van-icon name="calendar-o" />
        <span class="leave-range__text">{{ rangeLabel || t('trips.chooseDate') }}</span>
        <span class="leave-range__action">{{ t('leaveSheet.pickRange') }}</span>
      </button>
      <van-calendar
        v-model:show="calendarOpen"
        :key="calendarKey"
        type="range"
        teleport="body"
        :title="t('leaveSheet.calendarTitle')"
        :subtitle="undefined"
        allow-same-day
        :default-date="calendarDefault"
        :min-date="calendarMin"
        :max-date="calendarMax"
        :max-range="MAX_DAYS"
        :range-prompt="t('leaveSheet.maxDays', { max: MAX_DAYS })"
        :confirm-text="t('leaveSheet.confirm')"
        :confirm-disabled-text="t('leaveSheet.tapEnd')"
        @confirm="onCalendarConfirm"
      />
      <p class="leave-sheet__hint">{{ t('leaveSheet.hint') }}</p>
      <p v-if="rangeError" class="leave-sheet__error">{{ rangeError }}</p>

      <h3>{{ t('leaveSheet.type') }}</h3>
      <div class="leave-types" role="radiogroup" :aria-label="t('leaveSheet.type')">
        <button
          v-for="type in LEAVE_TYPES"
          :key="type.id"
          type="button"
          role="radio"
          class="leave-type"
          :class="{ 'is-selected': leaveType === type.id }"
          :aria-checked="leaveType === type.id"
          @click="leaveType = type.id"
        >
          {{ leaveTypeLabel(type.id, type.label) }}
        </button>
      </div>
      <p class="leave-sheet__note">{{ t('leaveSheet.note') }}</p>

      <div v-if="dates.length" class="leave-plan">
        <span>{{ t('leaveSheet.createCount', { count: plan.create.length }) }}</span>
        <span v-if="plan.updateLeave.length">{{ t('leaveSheet.updateCount', { count: plan.updateLeave.length }) }}</span>
        <span v-if="plan.conflicts.length" class="leave-plan__conflict">
          {{ t('leaveSheet.conflictCount', { count: plan.conflicts.length }) }}
        </span>
      </div>
      <div v-if="plan.conflicts.length" class="leave-conflict" role="alert">
        <strong>{{ t('leaveSheet.conflictTitle') }}</strong>
        <p>
          {{
            plan.conflicts
              .map((record) => `${record.workDate.slice(5)} ${record.startTime}–${record.endTime}`)
              .join('、')
          }}
        </p>
        <van-radio-group v-model="conflictMode" class="leave-conflict__options">
          <van-radio name="SKIP">{{ t('leaveSheet.skip') }}</van-radio>
          <van-radio name="REPLACE">{{ t('leaveSheet.replace') }}</van-radio>
        </van-radio-group>
      </div>

      <van-button block type="primary" class="leave-sheet__primary" @click="apply"
        >{{ t('leaveSheet.apply') }}</van-button
      >
    </div>
  </van-popup>
</template>

<style scoped>
.leave-sheet__body {
  max-height: 88dvh;
  overflow-y: auto;
  padding: 22px var(--page-inset) calc(16px + env(safe-area-inset-bottom, 0px));
}
h2 {
  margin: 0 0 12px;
  font-size: var(--font-heading);
  color: var(--color-heading);
}
h3 {
  margin: 16px 0 8px;
  font-size: 14px;
  color: var(--color-heading);
}
.leave-types {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}
.leave-type {
  min-height: var(--touch-target);
  padding: 8px 10px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  font: inherit;
  font-size: 14px;
  color: var(--color-heading);
}
.leave-type.is-selected {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 700;
}
.leave-sheet__note {
  margin: 10px 0;
  color: var(--color-muted);
  font-size: var(--font-caption);
  line-height: 1.5;
}
.leave-sheet__hint {
  margin: 8px 0 0;
  color: var(--color-muted);
  font-size: var(--font-caption);
}
.leave-range {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 56px;
  padding: 10px 14px;
  border: 1.5px solid var(--color-primary);
  border-radius: var(--radius-medium);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font: inherit;
  text-align: left;
}
.leave-range__text {
  flex: 1;
  font-size: 15px;
  font-weight: 700;
}
.leave-range__action {
  font-size: 13px;
  text-decoration: underline;
}
.leave-sheet__error {
  margin: 6px 16px;
  color: var(--color-expense);
  font-size: var(--font-caption);
}
.leave-plan {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: var(--color-heading);
}
.leave-plan span {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-primary-soft);
}
.leave-plan .leave-plan__conflict {
  background: var(--color-pending-soft);
  color: var(--color-pending);
}
.leave-conflict {
  margin-top: 12px;
  padding: 12px;
  border-radius: var(--radius-medium);
  background: var(--color-pending-soft);
  font-size: 13px;
  color: var(--color-heading);
}
.leave-conflict p {
  margin: 4px 0 10px;
  color: var(--color-pending);
}
.leave-conflict__options {
  display: grid;
  gap: 12px;
}
.leave-sheet__primary {
  margin-top: 16px;
  height: var(--page-button-height);
}
</style>

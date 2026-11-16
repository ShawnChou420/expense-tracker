<script setup>
// 請假（單日或一段期間）：選日期區間與請假類型。已有實際工作的日期列為衝突，由使用者決定略過或改成請假。
import { computed, ref, watch } from 'vue'
import { showToast } from 'vant'
import { LEAVE_TYPES, planBatchLeave } from '../domain/leaveTypes.js'
import { addDays, daysBetweenInclusive } from '../domain/visaJourney.js'

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

watch(
  () => props.show,
  (show) => {
    if (!show) return
    start.value = props.defaultDate
    end.value = props.defaultDate
    leaveType.value = 'HOLIDAY'
    conflictMode.value = 'SKIP'
  },
  { immediate: true },
)

const rangeError = computed(() => {
  if (!start.value || !end.value) return '請選擇日期'
  if (end.value < start.value) return '結束日期不可早於開始日期'
  if (daysBetweenInclusive(start.value, end.value) > MAX_DAYS) return `一次最多 ${MAX_DAYS} 天`
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
  if (!changed) return showToast('選取的日期都已有工作紀錄，沒有變更')
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
      <h2>請假</h2>
      <van-cell-group inset>
        <van-field v-model="start" type="date" label="開始日期" />
        <van-field v-model="end" type="date" label="結束日期" />
      </van-cell-group>
      <p v-if="rangeError" class="leave-sheet__error">{{ rangeError }}</p>

      <h3>請假類型</h3>
      <div class="leave-types" role="radiogroup" aria-label="請假類型">
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
          {{ type.label }}
        </button>
      </div>
      <p class="leave-sheet__note">
        請假一律無薪，不產生工時與薪資，也不計入集簽工作天。
      </p>

      <div v-if="dates.length" class="leave-plan">
        <span>新增 {{ plan.create.length }} 天</span>
        <span v-if="plan.updateLeave.length">更新 {{ plan.updateLeave.length }} 天請假</span>
        <span v-if="plan.conflicts.length" class="leave-plan__conflict">
          {{ plan.conflicts.length }} 天已有工作紀錄
        </span>
      </div>
      <div v-if="plan.conflicts.length" class="leave-conflict" role="alert">
        <strong>這些日期已有工作紀錄：</strong>
        <p>{{ plan.conflicts.map((record) => `${record.workDate.slice(5)} ${record.startTime}–${record.endTime}`).join('、') }}</p>
        <van-radio-group v-model="conflictMode" class="leave-conflict__options">
          <van-radio name="SKIP">保留工作紀錄，只把其他日期設為請假（建議）</van-radio>
          <van-radio name="REPLACE">這些日期也改成請假（原本的時間會保留，之後可以恢復）</van-radio>
        </van-radio-group>
      </div>

      <van-button block type="primary" class="leave-sheet__primary" @click="apply">套用請假</van-button>
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

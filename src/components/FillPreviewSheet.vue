<script setup>
// 填滿本週／本月前的預覽：使用者確認後才寫入；既有班表與休假不會被覆蓋。
import { useI18n } from 'vue-i18n'
import { formatAud } from '../domain/money.js'
import { formatHoursLabel as formatHours, joinList, weekdayShort } from '../i18n/format.js'

defineProps({
  show: Boolean,
  // { title, rangeLabel, records: [...], summary, skippedExisting, offDays }
  preview: { type: Object, default: null },
})
const emit = defineEmits(['update:show', 'confirm', 'edit-setup'])
const { t } = useI18n()
const weekdayOf = (date) => {
  const [y, m, d] = date.split('-').map(Number)
  return weekdayShort(new Date(y, m - 1, d))
}
const paidHoursNumber = (minutes) => {
  const hours = Math.round((minutes / 60) * 10) / 10
  return Number.isInteger(hours) ? hours : hours.toFixed(1)
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    safe-area-inset-bottom
    class="fill-sheet"
    @update:show="emit('update:show', $event)"
  >
    <div v-if="preview" class="fill">
      <header class="fill__header">
        <span>{{ preview.rangeLabel }}</span>
        <h2>{{ preview.title }}</h2>
      </header>

      <div v-if="preview.summary.shiftCount + preview.summary.leaveCount > 0" class="fill__body">
        <div class="fill__stats">
          <div>
            <small>{{ t('fillPreview.newShifts') }}</small>
            <strong>{{ preview.summary.shiftCount }}<em>{{ t('fillPreview.countUnit') }}</em></strong>
          </div>
          <div>
            <small>{{ t('fillPreview.paidHours') }}</small>
            <strong>{{ paidHoursNumber(preview.summary.paidMinutes) }}<em>{{ t('fillPreview.hoursUnit') }}</em></strong>
          </div>
          <div class="fill__stats--money">
            <small>{{ t('fillPreview.estimatedGross') }}</small>
            <strong>{{ formatAud(preview.summary.grossCents) }}</strong>
          </div>
        </div>
        <p v-if="preview.summary.rateFlags.provisional.length" class="fill__flag">
          <van-icon name="info-o" />{{ t('payrollPage.provisionalNote', { items: joinList(preview.summary.rateFlags.provisional) }) }}
        </p>
        <p v-if="preview.summary.rateFlags.excluded.length" class="fill__flag fill__flag--warn">
          <van-icon name="warning-o" />{{ t('fillPreview.excludedNote', { items: joinList(preview.summary.rateFlags.excluded) }) }}
        </p>
        <ul class="fill__list">
          <li v-for="record in preview.records" :key="record.workDate">
            <span class="fill__date">{{ record.workDate.slice(5).replace('-', '/') }}<small>{{ weekdayOf(record.workDate) }}</small></span>
            <span class="fill__shift">
              <template v-if="record.shiftType === 'leave'">{{ t('fillPreview.dayOff') }}</template>
              <template v-else>
                <strong>{{ record.shiftName || t('fillPreview.shift') }}</strong>
                <small><span class="nowrap">{{ record.startTime }}–{{ record.endTime }}{{ record.endTime <= record.startTime ? t('payrollPage.nextDayShort') : '' }}</span> · <span class="nowrap">{{ formatHours(record.paidMinutes) }}</span></small>
              </template>
            </span>
            <span class="fill__pay">{{ record.shiftType === 'leave' ? '' : formatAud(Math.round(record.grossPay * 100)) }}</span>
          </li>
        </ul>
        <p class="fill__note">
          <van-icon name="shield-o" />
          {{ t('fillPreview.keepExisting', { count: preview.skippedExisting }) }}{{ preview.offDays ? t('fillPreview.offDays', { count: preview.offDays }) : '' }}{{ t('fillPreview.editLater') }}
        </p>
      </div>
      <div v-else class="fill__empty">
        <van-icon name="passed" />
        <strong>{{ t('fillPreview.nothingToAdd') }}</strong>
        <p>
          {{ joinList([preview.skippedExisting ? t('fillPreview.emptyExisting', { count: preview.skippedExisting }) : '', preview.offDays ? t('fillPreview.emptyOff', { count: preview.offDays }) : ''].filter(Boolean)) }}
        </p>
      </div>

      <footer class="fill__footer">
        <button type="button" class="fill__edit" @click="emit('edit-setup')">
          <van-icon name="setting-o" />{{ t('fillPreview.adjustShifts') }}
        </button>
        <van-button
          v-if="preview.records.length"
          type="primary"
          block
          class="fill__confirm"
          @click="emit('confirm')"
        >
          {{ t('fillPreview.addRecords', { count: preview.records.length }) }}
        </van-button>
        <van-button v-else plain block class="fill__confirm" @click="emit('update:show', false)">{{ t('common.close') }}</van-button>
      </footer>
    </div>
  </van-popup>
</template>

<style scoped>
.fill-sheet {
  max-height: 90dvh;
}
.fill {
  display: flex;
  flex-direction: column;
  max-height: 90dvh;
  background: var(--color-background);
}
.fill__header {
  padding: 20px 20px 4px;
}
.fill__header span {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
}
.fill__header h2 {
  margin: 2px 0 0;
  color: var(--color-heading);
  font-size: 21px;
  font-weight: 800;
}
.fill__body {
  padding: 12px 20px 8px;
  overflow-y: auto;
}
.fill__stats {
  display: grid;
  grid-template-columns: 0.8fr 0.9fr 1.3fr;
  gap: 8px;
}
.fill__stats div {
  display: grid;
  gap: 2px;
  padding: 12px;
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}
.fill__stats small {
  color: var(--color-muted);
  font-size: 11px;
}
.fill__stats strong {
  color: var(--color-heading);
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.fill__stats em {
  color: var(--color-muted);
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
}
.fill__stats--money strong {
  color: var(--color-income);
  font-size: 18px;
}
.fill__flag {
  display: flex;
  gap: 6px;
  margin: 10px 0 0;
  padding: 10px 12px;
  border-radius: var(--radius-medium);
  background: var(--color-pending-soft);
  color: var(--color-pending);
  font-size: 12px;
  line-height: 1.5;
}
.fill__flag--warn {
  background: #fdecec;
  color: var(--color-expense);
}
.fill__list {
  margin: 12px 0 0;
  padding: 2px 14px;
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  list-style: none;
}
.fill__list li {
  display: grid;
  grid-template-columns: 52px 1fr auto;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  font-size: 13px;
}
.fill__list li + li {
  border-top: 1px solid var(--color-border);
}
.fill__date {
  display: grid;
  color: var(--color-heading);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.fill__date small {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 400;
}
.fill__shift {
  display: grid;
  color: var(--color-muted);
}
.fill__shift strong {
  color: var(--color-heading);
}
.fill__shift small {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.nowrap {
  white-space: nowrap;
}
.fill__pay {
  color: var(--color-income);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.fill__note {
  display: flex;
  gap: 6px;
  margin: 12px 2px 4px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}
.fill__empty {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 24px 20px;
  text-align: center;
}
.fill__empty .van-icon {
  color: var(--color-income);
  font-size: 36px;
}
.fill__empty strong {
  color: var(--color-heading);
  font-size: 16px;
}
.fill__empty p {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
}
.fill__footer {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.fill__edit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: var(--touch-target);
  padding: 0 8px;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.fill__confirm {
  height: var(--page-button-height);
  border-radius: var(--radius-button);
  font-weight: 700;
}
</style>

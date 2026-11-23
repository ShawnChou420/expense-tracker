<script setup>
// 首頁的集簽卡片。數字全部來自 getVisaJourneyProgress()；只是個人估算，不是官方認定。
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  /** 集簽設定；null＝尚未設定 */
  settings: { type: Object, default: null },
  /** getVisaJourneyProgress() 的結果 */
  progress: { type: Object, default: null },
})
const emit = defineEmits(['setup', 'import-history'])

const detailsOpen = ref(false)
const tracking = computed(() => props.settings && props.settings.goal && props.settings.goal !== 'NONE')
const recordedDays = computed(() => {
  const counts = props.progress?.counts
  if (!counts) return 0
  return counts.actualDays + counts.historicalDays + counts.partialDays
})
const showHistoryPrompt = computed(
  () => tracking.value && props.progress && !props.progress.hasHistory && !props.settings.historyDismissed,
)
const formatDate = (/** @type {string} */ date) => {
  const [y, m, d] = date.split('-').map(Number)
  return `${y}/${m}/${d}`
}
const estimateText = computed(() => {
  const estimate = props.progress?.estimate
  if (!estimate?.date) return null
  return estimate.basis === 'REACHED'
    ? t('visa.estimateReached', { date: formatDate(estimate.date) })
    : t('visa.estimateBy', { date: formatDate(estimate.date) })
})
</script>

<template>
  <section class="visa-card app-page__card" aria-labelledby="visa-card-title">
    <!-- 尚未設定 -->
    <template v-if="!settings">
      <div class="visa-card__head">
        <h2 id="visa-card-title">Visa Journey</h2>
      </div>
      <p class="visa-card__lead">{{ t('visa.setupLead') }}</p>
      <van-button type="primary" size="small" class="visa-card__cta" @click="emit('setup')">{{ t('visa.setGoal') }}</van-button>
    </template>

    <template v-else-if="tracking && progress">
      <div class="visa-card__head">
        <div>
          <span class="visa-card__status">{{ t('visa.tracking') }}</span>
          <h2 id="visa-card-title">{{ t(`visa.goals.${settings.goal}`) }}</h2>
        </div>
        <button type="button" class="visa-card__icon" :aria-label="t('visa.editSettings')" @click="emit('setup')">
          <van-icon name="setting-o" />
        </button>
      </div>

      <div class="visa-card__stats">
        <div>
          <strong>{{ recordedDays }}</strong>
          <span>{{ t('visa.recordedDays') }}</span>
        </div>
        <div>
          <strong>{{ progress.remainingDays }}</strong>
          <span>{{ t('visa.remainingEstimate') }}</span>
        </div>
      </div>

      <div class="visa-card__bar-label">
        <span>{{ t('visa.progressLabel') }}</span>
        <strong>{{ progress.percent }}%</strong>
      </div>
      <van-progress
        :percentage="progress.percent"
        :show-pivot="false"
        color="var(--color-primary)"
        track-color="var(--color-primary-soft)"
        stroke-width="8"
        :aria-label="t('visa.progressAria', { percent: progress.percent })"
      />
      <p class="visa-card__meta">
        {{ t('visa.requirement', { workDays: progress.requiredWorkDays, minDays: progress.minDays }) }}
        <template v-if="progress.counts?.historicalDays">{{ t('visa.historicalDays', { count: progress.counts.historicalDays }) }}</template>
      </p>
      <p v-if="progress.rule" class="visa-card__rule" role="note">
        <van-icon name="info-o" aria-hidden="true" />
        <span v-if="progress.rule.id === 'TRANSITIONAL'">{{ t('visa.ruleTransitional', { date: progress.rule.deadline }) }}</span>
        <span v-else>{{ t('visa.ruleNew', { date: progress.rule.effectiveFrom }) }}</span>
      </p>
      <p class="visa-card__estimate">
        <van-icon name="clock-o" />
        <span v-if="estimateText">{{ estimateText }}</span>
        <span v-else>{{ t('visa.estimateUnknown', { reason: progress.estimate?.reason || t('visa.notEnoughData') }) }}</span>
      </p>

      <div v-if="showHistoryPrompt" class="visa-card__prompt">
        <p>{{ t('visa.historyPrompt') }}</p>
        <van-button type="primary" size="small" @click="emit('import-history')">{{ t('visa.addHistory') }}</van-button>
      </div>

      <button
        v-if="progress.reviewItems.length"
        type="button"
        class="visa-card__review"
        :aria-expanded="detailsOpen"
        @click="detailsOpen = !detailsOpen"
      >
        <van-icon name="warning-o" /> {{ t('visa.reviewCount', { count: progress.reviewItems.length }) }}
        <van-icon :name="detailsOpen ? 'arrow-up' : 'arrow-down'" />
      </button>
      <button v-else type="button" class="visa-card__review is-quiet" :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen">
        {{ t('visa.basis') }} <van-icon :name="detailsOpen ? 'arrow-up' : 'arrow-down'" />
      </button>
      <div v-if="detailsOpen" class="visa-card__details">
        <ul v-if="progress.reviewItems.length">
          <li v-for="item in progress.reviewItems" :key="item.code">{{ item.message }}</li>
        </ul>
        <h3>{{ t('visa.basis') }}</h3>
        <ul>
          <li v-for="text in progress.assumptions" :key="text">{{ text }}</li>
          <li v-if="progress.payslip.checkedPayslips">
            {{ t('visa.payslipChecked', { payslips: progress.payslip.checkedPayslips, days: progress.payslip.supportedDays }) }}
          </li>
        </ul>
        <van-button v-if="!showHistoryPrompt" size="small" plain type="primary" @click="emit('import-history')">{{ t('visa.addHistory') }}</van-button>
      </div>
      <p class="visa-card__disclaimer">{{ t('visa.disclaimer') }}</p>
    </template>
  </section>
</template>

<style scoped>
.visa-card {
  display: grid;
  gap: 10px;
  padding: var(--page-card-padding);
  border: 1px solid var(--color-border);
}
.visa-card__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.visa-card h2 {
  margin: 4px 0 0;
  font-size: var(--font-heading);
  color: var(--color-heading);
}
.visa-card__status {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--color-income-soft);
  color: var(--color-income);
  font-size: var(--font-caption);
  font-weight: 700;
}
.visa-card__icon {
  width: var(--touch-target);
  height: var(--touch-target);
  margin: -8px -8px 0 0;
  border: 0;
  background: none;
  color: var(--color-muted);
  font-size: 20px;
}
.visa-card__lead,
.visa-card__meta {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--font-caption);
  line-height: 1.5;
}
.visa-card__cta {
  justify-self: start;
}
.visa-card__stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.visa-card__stats div {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--radius-medium);
  background: var(--color-background);
}
.visa-card__stats strong {
  font-size: 24px;
  color: var(--color-heading);
}
.visa-card__stats span {
  font-size: var(--font-caption);
  color: var(--color-muted);
}
.visa-card__bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--color-heading);
}
.visa-card__bar-label strong {
  color: var(--color-primary);
}
.visa-card__estimate {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 14px;
  color: var(--color-heading);
}
.visa-card__prompt {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-medium);
  background: var(--color-primary-soft);
}
.visa-card__prompt p {
  margin: 0;
  font-size: 14px;
  color: var(--color-heading);
  line-height: 1.5;
}
.visa-card__prompt .van-button {
  justify-self: start;
}
.visa-card__review {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  justify-self: start;
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: var(--color-pending-soft);
  color: var(--color-pending);
  font: inherit;
  font-size: 13px;
}
.visa-card__rule {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-medium);
  background: var(--color-pending-soft);
  color: var(--color-pending);
  font-size: var(--font-caption);
  line-height: 1.5;
}
.visa-card__rule .van-icon {
  flex: none;
  margin-top: 2px;
}
.visa-card__review.is-quiet {
  background: var(--color-background);
  color: var(--color-muted);
}
.visa-card__details {
  font-size: 13px;
  color: var(--color-heading);
  line-height: 1.6;
}
.visa-card__details h3 {
  margin: 8px 0 0;
  font-size: 13px;
}
.visa-card__details ul {
  margin: 4px 0 8px;
  padding-left: 18px;
}
.visa-card__disclaimer {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--font-caption);
}
</style>

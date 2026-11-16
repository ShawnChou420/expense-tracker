<script setup>
// 首頁的集簽卡片。數字全部來自 getVisaJourneyProgress()；只是個人估算，不是官方認定。
import { computed, ref } from 'vue'

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
    ? `估計 ${formatDate(estimate.date)} 已達最低要求`
    : `約 ${formatDate(estimate.date)}（依最近 4 週進度）`
})
</script>

<template>
  <section class="visa-card app-page__card" aria-labelledby="visa-card-title">
    <!-- 尚未設定 -->
    <template v-if="!settings">
      <div class="visa-card__head">
        <h2 id="visa-card-title">Visa Journey</h2>
      </div>
      <p class="visa-card__lead">正在集二簽或三簽嗎？設定一次，系統會依你的班表估算進度。</p>
      <van-button type="primary" size="small" class="visa-card__cta" @click="emit('setup')">設定集簽目標</van-button>
    </template>

    <template v-else-if="tracking && progress">
      <div class="visa-card__head">
        <div>
          <span class="visa-card__status">🏃 集簽中</span>
          <h2 id="visa-card-title">{{ progress.label }}</h2>
        </div>
        <button type="button" class="visa-card__icon" aria-label="修改集簽設定" @click="emit('setup')">
          <van-icon name="setting-o" />
        </button>
      </div>

      <div class="visa-card__stats">
        <div>
          <strong>{{ recordedDays }}</strong>
          <span>已記錄工作日</span>
        </div>
        <div>
          <strong>{{ progress.remainingDays }}</strong>
          <span>剩餘估算工作天</span>
        </div>
      </div>

      <div class="visa-card__bar-label">
        <span>歷史估算進度</span>
        <strong>{{ progress.percent }}%</strong>
      </div>
      <van-progress
        :percentage="progress.percent"
        :show-pivot="false"
        color="var(--color-primary)"
        track-color="var(--color-primary-soft)"
        stroke-width="8"
        :aria-label="`歷史估算進度 ${progress.percent}%`"
      />
      <p class="visa-card__meta">
        約需 {{ progress.requiredWorkDays }} 個全職工作天，且至少 {{ progress.minDays }} 個日曆天。
        <template v-if="progress.counts?.historicalDays">其中 {{ progress.counts.historicalDays }} 天為補登。</template>
      </p>
      <p class="visa-card__estimate">
        <van-icon name="clock-o" />
        <span v-if="estimateText">{{ estimateText }}</span>
        <span v-else>預估完成日期：{{ progress.estimate?.reason || '資料不足' }}</span>
      </p>

      <div v-if="showHistoryPrompt" class="visa-card__prompt">
        <p>已經開始工作了嗎？補登過去的班表，系統就能協助估算集簽進度。</p>
        <van-button type="primary" size="small" @click="emit('import-history')">補登歷史工作</van-button>
      </div>

      <button
        v-if="progress.reviewItems.length"
        type="button"
        class="visa-card__review"
        :aria-expanded="detailsOpen"
        @click="detailsOpen = !detailsOpen"
      >
        <van-icon name="warning-o" /> {{ progress.reviewItems.length }} 項需要核對
        <van-icon :name="detailsOpen ? 'arrow-up' : 'arrow-down'" />
      </button>
      <button v-else type="button" class="visa-card__review is-quiet" :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen">
        估算依據 <van-icon :name="detailsOpen ? 'arrow-up' : 'arrow-down'" />
      </button>
      <div v-if="detailsOpen" class="visa-card__details">
        <ul v-if="progress.reviewItems.length">
          <li v-for="item in progress.reviewItems" :key="item.code">{{ item.message }}</li>
        </ul>
        <h3>估算依據</h3>
        <ul>
          <li v-for="text in progress.assumptions" :key="text">{{ text }}</li>
          <li v-if="progress.payslip.checkedPayslips">
            已比對 {{ progress.payslip.checkedPayslips }} 張薪資單，{{ progress.payslip.supportedDays }} 天有薪資單佐證。
          </li>
        </ul>
        <van-button v-if="!showHistoryPrompt" size="small" plain type="primary" @click="emit('import-history')">補登歷史工作</van-button>
      </div>
      <p class="visa-card__disclaimer">個人估算，不代表 Home Affairs 認定。</p>
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
  font-size: 12px;
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
  font-size: 12px;
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
  font-size: 12px;
}
</style>

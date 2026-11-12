<script setup>
// 進度卡：標題、目前值／目標、進度條、補充說明，右上角可放動作按鈕（slot: action）。
const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  current: { type: String, required: true },
  target: { type: String, default: '' },
  percent: { type: Number, default: 0 },
  tone: { type: String, default: 'primary' }, // primary | warning | income
})
const width = () => `${Math.max(0, Math.min(100, props.percent))}%`
</script>

<template>
  <section class="progress-card app-page__card" :class="`progress-card--${tone}`">
    <div class="progress-card__head">
      <div>
        <h2>{{ title }}</h2>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <slot name="action" />
    </div>
    <div class="progress-card__numbers">
      <strong>{{ current }}</strong>
      <span v-if="target">/ {{ target }}</span>
    </div>
    <div
      class="progress-card__track"
      role="progressbar"
      :aria-valuenow="Math.round(percent)"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="progress-card__bar" :style="{ width: width() }" />
    </div>
    <slot />
  </section>
</template>

<style scoped>
.progress-card {
  padding: 16px;
  border: 1px solid var(--color-border);
}
.progress-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.progress-card__head h2 {
  margin: 0;
  color: var(--color-heading);
  font-size: 16px;
  font-weight: 800;
}
.progress-card__head p {
  margin: 3px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}
.progress-card__head :deep(.van-button) {
  flex: none;
}
.progress-card__numbers {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.progress-card__numbers strong {
  color: var(--color-heading);
  font-size: 22px;
  font-weight: 800;
}
.progress-card__numbers span {
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}
.progress-card__track {
  overflow: hidden;
  height: 10px;
  margin-top: 8px;
  border-radius: 999px;
  background: #edf2f7;
}
.progress-card__bar {
  height: 100%;
  border-radius: inherit;
  background: #1989fa;
  transition: width 0.3s ease;
}
.progress-card--warning .progress-card__bar {
  background: #f59e0b;
}
.progress-card--income .progress-card__bar {
  background: var(--color-income);
}
</style>

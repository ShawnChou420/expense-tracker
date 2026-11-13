<script setup>
// 進度卡：標題、目前值／目標、圓角進度條、左右兩個補充數字；右上角可放動作（slot: action）。
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  badge: { type: String, default: '' },
  current: { type: String, default: '' },
  target: { type: String, default: '' },
  percent: { type: Number, default: 0 },
  footLeft: { type: String, default: '' },
  footRight: { type: String, default: '' },
  tone: { type: String, default: 'primary' }, // primary | income | warning
})
const width = computed(() => `${Math.max(0, Math.min(100, props.percent))}%`)
</script>

<template>
  <section class="progress-card app-page__card" :class="`progress-card--${tone}`">
    <div class="progress-card__head">
      <div class="progress-card__titles">
        <h2>
          {{ title }}<em v-if="badge" class="progress-card__badge">{{ badge }}</em>
        </h2>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <slot name="action" />
    </div>
    <slot name="empty">
      <div class="progress-card__numbers">
        <strong>{{ current }}</strong>
        <span v-if="target">/ {{ target }}</span>
      </div>
      <div
        class="progress-card__track"
        role="progressbar"
        :aria-label="title"
        :aria-valuenow="Math.round(percent)"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="progress-card__bar" :style="{ width }" />
      </div>
      <div v-if="footLeft || footRight" class="progress-card__foot">
        <span>{{ footLeft }}</span>
        <strong>{{ footRight }}</strong>
      </div>
    </slot>
    <slot />
  </section>
</template>

<style scoped>
.progress-card {
  padding: var(--page-card-padding);
  border: 1px solid var(--color-border);
}
.progress-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.progress-card__titles {
  min-width: 0;
}
.progress-card__head h2 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  color: var(--color-heading);
  font-size: 16px;
  font-weight: 800;
}
.progress-card__badge {
  padding: 1px 8px;
  border-radius: 999px;
  background: #eef2f7;
  color: var(--color-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
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
  margin-top: 14px;
}
.progress-card__numbers strong {
  color: var(--color-heading);
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.progress-card__numbers span {
  color: var(--color-muted);
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.progress-card__track {
  overflow: hidden;
  height: 10px;
  margin-top: 10px;
  border-radius: 999px;
  background: #edf1f6;
}
.progress-card__bar {
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 0.25s ease;
}
.progress-card--income .progress-card__bar {
  background: var(--color-income);
}
.progress-card--warning .progress-card__bar {
  background: var(--color-pending-bar);
}
.progress-card__foot {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
  font-size: 13px;
}
.progress-card__foot span {
  color: var(--color-muted);
  font-weight: 700;
}
.progress-card__foot strong {
  color: var(--color-heading);
  font-weight: 800;
  text-align: right;
}
.progress-card--income .progress-card__foot strong {
  color: var(--color-income);
}
.progress-card--warning .progress-card__foot strong {
  color: var(--color-pending);
}
</style>

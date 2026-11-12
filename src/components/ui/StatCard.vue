<script setup>
// 小數字卡：標題、主要數字、補充說明。傳入 clickable 時整張卡可點擊。
defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  hint: { type: String, default: '' },
  badge: { type: String, default: '' },
  tone: { type: String, default: 'default' }, // default | income | expense | primary | pending
  clickable: Boolean,
})
const emit = defineEmits(['click'])
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="stat-card app-page__card"
    :class="[`stat-card--${tone}`, { 'stat-card--clickable': clickable }]"
    @click="clickable && emit('click')"
  >
    <span class="stat-card__label">
      {{ label }}<em v-if="badge" class="stat-card__badge">{{ badge }}</em>
    </span>
    <strong class="stat-card__value">{{ value }}</strong>
    <small v-if="hint" class="stat-card__hint">{{ hint }}</small>
    <slot />
  </component>
</template>

<style scoped>
.stat-card {
  display: grid;
  align-content: start;
  gap: 4px;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 16px;
  border: 1px solid var(--color-border);
  color: inherit;
  font: inherit;
  text-align: left;
  transition: transform var(--motion-fast) ease;
}
.stat-card--clickable {
  cursor: pointer;
}
.stat-card--clickable:active {
  transform: scale(0.98);
}
.stat-card--clickable:focus-visible {
  outline: 3px solid rgba(18, 104, 218, 0.35);
  outline-offset: 2px;
}
.stat-card__label {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}
.stat-card__badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: #eef2f7;
  color: var(--color-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}
.stat-card__value {
  color: var(--color-heading);
  font-size: 24px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.stat-card--primary .stat-card__value {
  color: var(--color-primary);
}
.stat-card--income .stat-card__value {
  color: var(--color-income);
}
.stat-card--expense .stat-card__value {
  color: var(--color-expense);
}
.stat-card--pending .stat-card__value {
  color: var(--color-pending);
}
.stat-card__hint {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}
.stat-card--pending .stat-card__hint {
  color: var(--color-pending);
}
</style>

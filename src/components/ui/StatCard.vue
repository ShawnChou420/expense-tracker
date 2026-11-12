<script setup>
// 大數字卡：標題、主要數字、補充說明。傳入 clickable 時整張卡可點擊。
defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  hint: { type: String, default: '' },
  tone: { type: String, default: 'default' }, // default | income | expense | primary
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
    <span class="stat-card__label">{{ label }}</span>
    <strong class="stat-card__value">{{ value }}</strong>
    <small v-if="hint" class="stat-card__hint">{{ hint }}</small>
    <slot />
    <van-icon v-if="clickable" class="stat-card__arrow" name="arrow" aria-hidden="true" />
  </component>
</template>

<style scoped>
.stat-card {
  position: relative;
  display: grid;
  gap: 4px;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  color: inherit;
  font: inherit;
  text-align: left;
}
.stat-card--clickable {
  padding-right: 34px;
  cursor: pointer;
}
.stat-card--clickable:active {
  transform: scale(0.99);
}
.stat-card__label {
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}
.stat-card__value {
  color: var(--color-heading);
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}
.stat-card--primary .stat-card__value {
  color: #166dd1;
}
.stat-card--income .stat-card__value {
  color: var(--color-income);
}
.stat-card--expense .stat-card__value {
  color: var(--color-expense);
}
.stat-card__hint {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}
.stat-card__arrow {
  position: absolute;
  top: 50%;
  right: 12px;
  color: #a7b4c2;
  transform: translateY(-50%);
}
</style>

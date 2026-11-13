<script setup>
// 首頁快捷操作：三個等寬按鈕，每個都直接連到既有頁面或表單。
defineProps({
  actions: { type: Array, required: true }, // [{ key, label, icon }]
})
const emit = defineEmits(['select'])
</script>

<template>
  <nav class="quick-actions" aria-label="快捷操作">
    <button
      v-for="action in actions"
      :key="action.key"
      type="button"
      class="quick-actions__item"
      @click="emit('select', action.key)"
    >
      <span class="quick-actions__icon" aria-hidden="true"><van-icon :name="action.icon" /></span>
      <span class="quick-actions__label">{{ action.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.quick-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.quick-actions__item {
  display: grid;
  justify-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 84px;
  padding: 14px 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--page-card-radius);
  background: var(--color-surface);
  color: var(--color-heading);
  font: inherit;
  cursor: pointer;
  transition:
    transform var(--motion-fast) ease,
    border-color var(--motion-fast) ease;
}
.quick-actions__item:active {
  transform: scale(0.97);
  border-color: var(--color-primary);
}
.quick-actions__item:focus-visible {
  outline: 3px solid rgba(18, 104, 218, 0.35);
  outline-offset: 2px;
}
.quick-actions__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 21px;
}
.quick-actions__label {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
}
</style>

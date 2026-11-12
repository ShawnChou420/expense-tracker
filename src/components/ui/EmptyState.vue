<script setup>
// 空狀態：圖示＋一句說明＋行動按鈕。
defineProps({
  icon: { type: String, default: 'info-o' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  actionLabel: { type: String, default: '' },
  // 放在卡片裡時用上下排列，讓說明文字有足夠寬度
  stacked: Boolean,
})
const emit = defineEmits(['action'])
</script>

<template>
  <div class="empty-state-box" :class="{ 'empty-state-box--stacked': stacked }">
    <span class="empty-state-box__icon" aria-hidden="true"><van-icon :name="icon" /></span>
    <div class="empty-state-box__text">
      <strong>{{ title }}</strong>
      <p v-if="description">{{ description }}</p>
    </div>
    <van-button v-if="actionLabel" size="small" type="primary" plain @click="emit('action')">
      {{ actionLabel }}
    </van-button>
  </div>
</template>

<style scoped>
.empty-state-box {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px dashed #c9dbf3;
  border-radius: var(--radius-medium);
  background: #f8fbff;
}
.empty-state-box__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 20px;
}
.empty-state-box__text {
  flex: 1;
  min-width: 0;
}
.empty-state-box__text strong {
  color: var(--color-heading);
  font-size: 14px;
}
.empty-state-box__text p {
  margin: 2px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}
.empty-state-box :deep(.van-button) {
  flex: none;
}
.empty-state-box--stacked {
  flex-wrap: wrap;
  align-items: flex-start;
}
.empty-state-box--stacked .empty-state-box__text {
  flex: 1 1 180px;
}
.empty-state-box--stacked :deep(.van-button) {
  width: 100%;
  min-height: var(--touch-target);
  border-radius: var(--radius-button);
  font-size: 14px;
  font-weight: 800;
}
</style>

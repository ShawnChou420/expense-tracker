<script setup>
// 首頁主卡：藍底白字，最大的數字放在最上層；沒有資料時顯示空狀態與行動按鈕。
defineProps({
  label: { type: String, required: true },
  amount: { type: String, default: '' },
  unit: { type: String, default: '' },
  meta: { type: String, default: '' },
  items: { type: Array, default: () => [] }, // [{ label, value }]
  empty: Boolean,
  emptyTitle: { type: String, default: '' },
  emptyDescription: { type: String, default: '' },
  emptyActionLabel: { type: String, default: '' },
  emptyActionIcon: { type: String, default: 'plus' },
})
const emit = defineEmits(['open', 'action'])
</script>

<template>
  <section class="hero-card" :class="{ 'hero-card--empty': empty }">
    <template v-if="!empty">
      <button type="button" class="hero-card__tap" @click="emit('open')">
        <span class="hero-card__label">{{ label }}</span>
        <span class="hero-card__amount">
          <strong>{{ amount }}</strong>
          <small v-if="unit">{{ unit }}</small>
        </span>
        <span v-if="meta" class="hero-card__meta">{{ meta }}</span>
        <span v-if="items.length" class="hero-card__items">
          <span v-for="item in items" :key="item.label" class="hero-card__item">
            <small>{{ item.label }}</small>
            <strong>{{ item.value }}</strong>
          </span>
        </span>
        <van-icon name="arrow" class="hero-card__arrow" aria-hidden="true" />
      </button>
    </template>
    <div v-else class="hero-card__empty">
      <span class="hero-card__label">{{ label }}</span>
      <strong>{{ emptyTitle }}</strong>
      <p v-if="emptyDescription">{{ emptyDescription }}</p>
      <button type="button" class="hero-card__cta" @click="emit('action')">
        <van-icon :name="emptyActionIcon" aria-hidden="true" />{{ emptyActionLabel }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.hero-card {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-hero);
  background:
    radial-gradient(circle at 100% 0, rgba(255, 255, 255, 0.16) 0, transparent 46%),
    var(--color-primary);
  color: #fff;
  box-shadow: 0 10px 28px rgba(18, 104, 218, 0.24);
}
.hero-card__tap {
  display: grid;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 20px 20px 18px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform var(--motion-fast) ease;
}
.hero-card__tap:active {
  transform: scale(0.99);
}
.hero-card__tap:focus-visible,
.hero-card__cta:focus-visible {
  outline: 3px solid rgba(255, 255, 255, 0.7);
  outline-offset: -3px;
  border-radius: var(--radius-hero);
}
.hero-card__label {
  color: #e7f0fb;
  font-size: 14px;
  font-weight: 700;
}
.hero-card__amount {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.hero-card__amount strong {
  font-size: var(--font-amount);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.hero-card__amount small {
  color: #e7f0fb;
  font-size: 14px;
  font-weight: 700;
}
.hero-card__meta {
  color: #e7f0fb;
  font-size: 13px;
}
.hero-card__items {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 10px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}
.hero-card__item {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.hero-card__item small {
  color: #e7f0fb;
  font-size: 12px;
}
.hero-card__item strong {
  font-size: 17px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.hero-card__arrow {
  position: absolute;
  top: 22px;
  right: 18px;
  color: rgba(255, 255, 255, 0.75);
}
.hero-card__empty {
  display: grid;
  gap: 6px;
  padding: 20px;
}
.hero-card__empty strong {
  font-size: 20px;
  font-weight: 800;
}
.hero-card__empty p {
  margin: 0;
  color: #e7f0fb;
  font-size: 13px;
  line-height: 1.5;
}
.hero-card__cta {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 6px;
  min-height: var(--touch-target);
  margin-top: 8px;
  padding: 0 18px;
  border: 0;
  border-radius: var(--radius-button);
  background: #fff;
  color: var(--color-primary);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}
</style>

<script setup>
// 本週／本月切換＋上一期／下一期＋返回本期。
defineProps({
  period: { type: String, required: true }, // week | month
  rangeLabel: { type: String, required: true },
  isCurrent: Boolean,
})
const emit = defineEmits(['update:period', 'move', 'reset'])
</script>

<template>
  <section class="period-switcher app-page__card" aria-label="日期篩選">
    <div class="period-switcher__modes">
      <button
        type="button"
        :class="{ selected: period === 'week' }"
        @click="emit('update:period', 'week')"
      >
        本週
      </button>
      <button
        type="button"
        :class="{ selected: period === 'month' }"
        @click="emit('update:period', 'month')"
      >
        本月
      </button>
    </div>
    <div class="period-switcher__nav">
      <button type="button" aria-label="上一期" @click="emit('move', -1)">
        <van-icon name="arrow-left" />
      </button>
      <strong>{{ rangeLabel }}</strong>
      <button type="button" aria-label="下一期" @click="emit('move', 1)">
        <van-icon name="arrow" />
      </button>
    </div>
    <button v-if="!isCurrent" class="period-switcher__reset" type="button" @click="emit('reset')">
      返回本期
    </button>
  </section>
</template>

<style scoped>
.period-switcher {
  padding: 16px;
}
.period-switcher__modes {
  display: flex;
  gap: 7px;
}
.period-switcher__modes button {
  min-height: var(--touch-target);
  padding: 7px 14px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: #fff;
  color: #345474;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}
.period-switcher__modes button.selected {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.period-switcher__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 9px;
}
.period-switcher__nav button {
  flex: none;
  width: var(--touch-target);
  height: var(--touch-target);
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: #f8fafc;
  color: #345474;
}
.period-switcher__nav strong {
  text-align: center;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.period-switcher__reset {
  margin-top: 5px;
  padding: 7px 0;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}
</style>

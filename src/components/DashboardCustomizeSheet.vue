<script setup>
// 自訂首頁：切換薪資優先／生活優先、開關模組、上移下移、恢復預設。
// 每次變更立即套用並交給父元件儲存；隱藏只影響首頁畫面，不會刪除任何資料。
import { computed } from 'vue'
import { showConfirmDialog } from 'vant'
import {
  DASHBOARD_MODES,
  DASHBOARD_MODULES,
  getDefaultLayout,
  isModuleAvailable,
  isSameLayout,
  moveModule,
  setModuleVisible,
} from '../domain/dashboardLayout.js'

const props = defineProps({
  show: { type: Boolean, default: false },
  /** @type {import('vue').PropType<import('../domain/dashboardLayout.js').DashboardLayout>} */
  layout: { type: Object, required: true },
  /** @type {import('vue').PropType<import('../domain/dashboardLayout.js').DashboardContext>} */
  context: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:show', 'change'])

const labels = Object.fromEntries(DASHBOARD_MODULES.map((module) => [module.id, module.label]))
const rows = computed(() =>
  props.layout.modules.filter((module) => isModuleAvailable(module.id, props.context)),
)
const modeLabel = computed(
  () => DASHBOARD_MODES.find((mode) => mode.id === props.layout.mode)?.label ?? '',
)

function apply(/** @type {import('../domain/dashboardLayout.js').DashboardLayout} */ next) {
  if (!isSameLayout(next, props.layout)) emit('change', next)
}

async function switchMode(/** @type {'PAY' | 'LIFE'} */ mode) {
  if (mode === props.layout.mode) return
  const label = DASHBOARD_MODES.find((item) => item.id === mode)?.label ?? ''
  try {
    await showConfirmDialog({
      title: `切換成${label}？`,
      message: `會套用${label}的預設順序與顯示，你之前的調整會被取代。`,
      confirmButtonText: '切換',
    })
  } catch {
    return
  }
  apply(getDefaultLayout(mode))
}

async function resetLayout() {
  try {
    await showConfirmDialog({
      title: '恢復預設？',
      message: `回到「${modeLabel.value}」的預設順序與顯示。資料不會被刪除。`,
      confirmButtonText: '恢復預設',
    })
  } catch {
    return
  }
  apply(getDefaultLayout(props.layout.mode))
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    safe-area-inset-bottom
    teleport="body"
    class="customize-sheet"
    @update:show="emit('update:show', $event)"
  >
    <div class="customize">
      <header class="customize__head">
        <h2>自訂首頁</h2>
        <button type="button" class="customize__reset" @click="resetLayout">恢復預設</button>
        <button
          type="button"
          class="customize__close"
          aria-label="關閉"
          @click="emit('update:show', false)"
        >
          <van-icon name="cross" />
        </button>
      </header>

      <div class="customize__modes" role="radiogroup" aria-label="首頁模式">
        <button
          v-for="mode in DASHBOARD_MODES"
          :key="mode.id"
          type="button"
          role="radio"
          :aria-checked="layout.mode === mode.id"
          :class="{ 'is-active': layout.mode === mode.id }"
          @click="switchMode(mode.id)"
        >
          {{ mode.label }}
        </button>
      </div>

      <ol class="customize__list">
        <li
          v-for="(module, index) in rows"
          :key="module.id"
          class="customize__row"
          :class="{ 'is-hidden': !module.visible }"
        >
          <span class="customize__label">{{ labels[module.id] }}</span>
          <div class="customize__actions">
            <button
              type="button"
              class="customize__move"
              :aria-label="`上移 ${labels[module.id]}`"
              :disabled="index === 0"
              @click="apply(moveModule(layout, module.id, -1, context))"
            >
              <van-icon name="arrow-up" />
            </button>
            <button
              type="button"
              class="customize__move"
              :aria-label="`下移 ${labels[module.id]}`"
              :disabled="index === rows.length - 1"
              @click="apply(moveModule(layout, module.id, 1, context))"
            >
              <van-icon name="arrow-down" />
            </button>
            <van-switch
              :model-value="module.visible"
              size="22px"
              :aria-label="`${module.visible ? '隱藏' : '顯示'} ${labels[module.id]}`"
              @update:model-value="apply(setModuleVisible(layout, module.id, $event))"
            />
          </div>
        </li>
      </ol>
      <p class="customize__note">隱藏只影響首頁畫面，不會刪除資料。</p>
    </div>
  </van-popup>
</template>

<style scoped>
.customize {
  display: grid;
  gap: var(--space-row);
  max-height: 85dvh;
  overflow-y: auto;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
}
.customize__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.customize__head h2 {
  margin: 0 auto 0 0;
  color: var(--color-heading);
  font-size: var(--font-heading);
}
.customize__reset,
.customize__close {
  min-height: var(--touch-target);
  padding: 0 8px;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.customize__close {
  min-width: var(--touch-target);
  color: var(--color-muted);
  font-size: 18px;
}
.customize__modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-medium);
  background: var(--color-background);
}
.customize__modes button {
  min-height: 40px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--color-muted);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.customize__modes button.is-active {
  background: var(--color-surface);
  color: var(--color-primary);
  box-shadow: var(--shadow-card);
}
.customize__list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
}
.customize__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 52px;
  padding: 4px 8px 4px 14px;
  border-top: 1px solid var(--color-border);
}
.customize__row:first-child {
  border-top: 0;
}
.customize__label {
  min-width: 0;
  color: var(--color-heading);
  font-size: 15px;
  overflow-wrap: anywhere;
}
.customize__row.is-hidden .customize__label {
  color: var(--color-muted);
}
.customize__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
.customize__move {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--color-muted);
  font-size: 16px;
  cursor: pointer;
}
.customize__move:disabled {
  opacity: 0.3;
  cursor: default;
}
.customize__move:not(:disabled):active {
  background: var(--color-primary-soft);
}
.customize__actions :deep(.van-switch) {
  margin-left: 6px;
}
.customize__note {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--font-caption);
}
</style>

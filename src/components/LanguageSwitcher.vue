<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { showToast } from 'vant'
import { LOCALE_OPTIONS } from '../domain/locale.js'
import { changeLocale } from '../services/localePreference.js'

defineProps({
  /** compact：首頁右上角的小按鈕；cell：設定頁的一列 */
  variant: { type: String, default: 'compact' },
})

const { t, locale } = useI18n()
const open = ref(false)
const currentLabel = computed(
  () => LOCALE_OPTIONS.find((option) => option.value === locale.value)?.label ?? locale.value,
)
const shortLabel = computed(
  () => ({ 'zh-TW': '中', 'en-AU': 'EN', ja: '日', ko: '한' })[locale.value] ?? 'EN',
)
const actions = computed(() =>
  LOCALE_OPTIONS.map((option) => ({
    name: option.label,
    value: option.value,
    color: option.value === locale.value ? 'var(--color-primary, #1268da)' : undefined,
    subname: option.value === locale.value ? '✓' : undefined,
  })),
)

async function select(action) {
  open.value = false
  if (action.value === locale.value) return
  try {
    await changeLocale(action.value)
  } catch {
    showToast(t('language.syncFailed'))
  }
}
</script>

<template>
  <van-cell
    v-if="variant === 'cell'"
    :title="t('language.label')"
    :value="currentLabel"
    icon="globe-o"
    is-link
    @click="open = true"
  />
  <button
    v-else
    type="button"
    class="language-switcher"
    :aria-label="`${t('language.label')}：${currentLabel}`"
    @click="open = true"
  >
    <van-icon name="globe-o" aria-hidden="true" />
    <span>{{ shortLabel }}</span>
  </button>
  <van-action-sheet
    v-model:show="open"
    :title="t('language.choose')"
    :actions="actions"
    :cancel-text="t('common.cancel')"
    close-on-click-action
    teleport="body"
    @select="select"
  />
</template>

<style scoped>
.language-switcher {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 18px;
  background: var(--color-surface, #fff);
  color: var(--color-text, #1f2937);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.language-switcher .van-icon {
  font-size: 16px;
}
</style>

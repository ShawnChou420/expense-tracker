<script setup>
// 可以直接打字的時間欄位：失焦或按 Enter 時整理成 HH:MM；右邊時鐘圖示才打開滾輪。
import { computed, ref, watch } from 'vue'
import { parseTimeInput } from '../domain/timeInput.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue', 'update:invalid', 'open-picker'])

const draft = ref(props.modelValue)

// 外部改了時間（滾輪、微調、換日期、套用班別）就同步顯示
watch(
  () => props.modelValue,
  (value) => {
    draft.value = value
  },
)

const parsed = computed(() => parseTimeInput(draft.value))
const hasText = computed(() => draft.value.trim() !== '')
const invalid = computed(() => hasText.value && !parsed.value)
watch(invalid, (value) => emit('update:invalid', value), { immediate: true })

const hint = computed(() => {
  if (invalid.value) return { error: true, text: '請輸入像 17:00 的時間' }
  if (parsed.value && parsed.value !== draft.value) return { error: false, text: `→ ${parsed.value}` }
  return null
})

function commit() {
  if (!hasText.value) {
    if (props.modelValue) emit('update:modelValue', '')
    return
  }
  // 無效的內容留在欄位上並顯示錯誤，不改動原本的時間；儲存時會被擋下
  if (!parsed.value) return
  draft.value = parsed.value
  if (parsed.value !== props.modelValue) emit('update:modelValue', parsed.value)
}

function onKeypress(event) {
  if (event.key === 'Enter') event.target.blur()
}
</script>

<template>
  <div class="time-text-field">
    <van-field
      v-model="draft"
      :label="label"
      placeholder="例如 17:00"
      input-align="right"
      inputmode="numeric"
      maxlength="5"
      autocomplete="off"
      enterkeyhint="done"
      :error="Boolean(hint?.error)"
      right-icon="clock-o"
      @blur="commit"
      @keypress="onKeypress"
      @click-right-icon="emit('open-picker')"
    />
    <p v-if="hint" class="time-text-field__hint" :class="{ 'is-error': hint.error }" :role="hint.error ? 'alert' : undefined">{{ hint.text }}</p>
  </div>
</template>

<style scoped>
.time-text-field__hint {
  margin: -4px 16px 8px;
  text-align: right;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-primary);
}
.time-text-field__hint.is-error { color: var(--color-expense); }
</style>

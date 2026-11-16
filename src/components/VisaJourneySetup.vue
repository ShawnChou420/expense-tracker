<script setup>
// 集簽首次設定：先問目標，選二簽／三簽才問必要的簽證資料。不集簽時其他欄位不需要填。
import { computed, ref, watch } from 'vue'
import { showToast } from 'vant'
import {
  VISA_GOALS,
  VISA_STAGES,
  createEmptyVisaJourney,
  normalizeVisaJourney,
  validateVisaJourney,
} from '../domain/visaJourney.js'

const props = defineProps({
  show: Boolean,
  /** 目前的設定（修改時帶入） */
  settings: { type: Object, default: null },
  /** 沒有設定時，開始日期的預設值 */
  today: { type: String, required: true },
  /** 儲存（async）；失敗時丟出錯誤，畫面保持開啟 */
  submit: { type: Function, required: true },
})
const emit = defineEmits(['update:show'])

const step = ref('goal')
const form = ref(createEmptyVisaJourney())
const saving = ref(false)

const goals = [
  { id: 'SECOND', title: '集二簽', detail: '3 個月，最低 88 天日曆期間等值' },
  { id: 'THIRD', title: '集三簽', detail: '6 個月，最低 179 天日曆期間等值' },
  { id: 'NONE', title: '目前不集簽', detail: '首頁不顯示進度，工作紀錄照常保留' },
]

watch(
  () => props.show,
  (show) => {
    if (!show) return
    form.value = normalizeVisaJourney(props.settings ?? createEmptyVisaJourney())
    step.value = 'goal'
  },
  { immediate: true },
)

const goalInfo = computed(() =>
  form.value.goal && form.value.goal !== 'NONE' ? VISA_GOALS[form.value.goal] : null,
)

function chooseGoal(goal) {
  form.value.goal = goal
  if (goal === 'NONE') return
  // 二簽的工作要在第一簽期間完成、三簽在第二簽期間：預先選好對應階段，使用者可以改
  if (!form.value.stage) form.value.stage = VISA_GOALS[goal].priorStage
  if (!form.value.workStart) form.value.workStart = props.today
  step.value = 'details'
}

async function save() {
  const error = validateVisaJourney(form.value)
  if (error) return showToast(error)
  saving.value = true
  try {
    await props.submit({ ...form.value })
  } catch (error) {
    showToast(error?.message || '儲存失敗')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    closeable
    safe-area-inset-bottom
    class="visa-setup"
    @update:show="emit('update:show', $event)"
  >
    <div class="visa-setup__body">
      <template v-if="step === 'goal'">
        <p class="visa-setup__eyebrow">Visa Journey</p>
        <h2>你目前的集簽目標是？</h2>
        <div class="visa-setup__options" role="radiogroup" aria-label="集簽目標">
          <button
            v-for="goal in goals"
            :key="goal.id"
            type="button"
            role="radio"
            class="visa-option"
            :class="{ 'is-selected': form.goal === goal.id }"
            :aria-checked="form.goal === goal.id"
            :aria-label="`${goal.title}：${goal.detail}`"
            @click="chooseGoal(goal.id)"
          >
            <strong>{{ goal.title }}</strong>
            <small>{{ goal.detail }}</small>
          </button>
        </div>
        <van-button
          v-if="form.goal === 'NONE'"
          block
          type="primary"
          class="visa-setup__primary"
          :loading="saving"
          @click="save"
          >儲存</van-button
        >
      </template>

      <template v-else>
        <button type="button" class="visa-setup__back" @click="step = 'goal'">
          <van-icon name="arrow-left" /> 重新選擇目標
        </button>
        <h2>{{ goalInfo?.label }}：基本資料</h2>
        <p class="visa-setup__note">只需要這些資料；班別與排班會直接沿用你的工作設定。</p>

        <div class="visa-field">
          <span class="visa-field__label">簽證類型</span>
          <van-radio-group v-model="form.subclass" direction="horizontal">
            <van-radio name="417">417</van-radio>
            <van-radio name="462">462</van-radio>
          </van-radio-group>
        </div>
        <div class="visa-field">
          <span class="visa-field__label">目前簽證階段</span>
          <van-radio-group v-model="form.stage" class="visa-field__stack">
            <van-radio v-for="stage in VISA_STAGES" :key="stage.id" :name="stage.id">{{
              stage.label
            }}</van-radio>
          </van-radio-group>
        </div>
        <van-field v-model="form.stayUntil" type="date" label="Stay until" label-width="8.5em" required />
        <van-field v-model="form.workStart" type="date" label="指定工作開始日" label-width="8.5em" required />
        <p class="visa-setup__hint">填實際開始做指定工作（符合行業與郵遞區號）的日期。</p>
        <van-cell center title="我已經開始集簽">
          <template #right-icon>
            <van-switch v-model="form.started" size="22px" aria-label="我已經開始集簽" />
          </template>
        </van-cell>
        <p class="visa-setup__disclaimer">
          進度只是依你的紀錄做的個人估算，不代表 Home Affairs 的認定。
        </p>
        <van-button block type="primary" class="visa-setup__primary" :loading="saving" @click="save"
          >儲存並開始追蹤</van-button
        >
      </template>
    </div>
  </van-popup>
</template>

<style scoped>
.visa-setup__body {
  max-height: 88dvh;
  overflow-y: auto;
  padding: 22px var(--page-inset) calc(16px + env(safe-area-inset-bottom, 0px));
}
.visa-setup__eyebrow {
  margin: 0;
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
h2 {
  margin: 4px 0 14px;
  color: var(--color-heading);
  font-size: var(--font-heading);
}
.visa-setup__options {
  display: grid;
  gap: 10px;
}
.visa-option {
  display: grid;
  gap: 4px;
  min-height: 64px;
  padding: 14px 16px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  text-align: left;
  font: inherit;
  color: var(--color-heading);
  cursor: pointer;
}
.visa-option strong {
  font-size: 16px;
}
.visa-option small {
  color: var(--color-muted);
  font-size: var(--font-caption);
}
.visa-option.is-selected {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}
.visa-setup__back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: var(--touch-target);
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: var(--font-caption);
}
.visa-setup__note,
.visa-setup__hint,
.visa-setup__disclaimer {
  margin: 0 0 12px;
  color: var(--color-muted);
  font-size: var(--font-caption);
  line-height: 1.5;
}
.visa-setup__hint {
  margin: 4px 16px 8px;
}
.visa-setup__disclaimer {
  margin-top: 12px;
}
.visa-field {
  display: grid;
  gap: 8px;
  padding: 10px 16px;
}
.visa-field__label {
  color: var(--color-heading);
  font-size: 14px;
  font-weight: 600;
}
.visa-field__stack {
  display: grid;
  gap: 10px;
}
.visa-setup__primary {
  margin-top: 16px;
  height: var(--page-button-height);
}
</style>

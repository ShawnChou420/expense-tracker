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
import { useI18n } from 'vue-i18n'
import { localizeMessage } from '../i18n/messages.js'

const { t } = useI18n()

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

const goals = computed(() =>
  ['SECOND', 'THIRD', 'NONE'].map((id) => ({ id, title: t(`visa.goals.${id}`), detail: t(`visa.goalDetails.${id}`) })),
)

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
  if (error) return showToast(localizeMessage(error))
  saving.value = true
  try {
    await props.submit({ ...form.value })
  } catch (error) {
    showToast(localizeMessage(error?.message) || t('errors.saveFailed'))
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
        <h2>{{ t('visa.goalQuestion') }}</h2>
        <div class="visa-setup__options" role="radiogroup" :aria-label="t('visa.goalAria')">
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
          >{{ t('common.save') }}</van-button
        >
      </template>

      <template v-else>
        <button type="button" class="visa-setup__back" @click="step = 'goal'">
          <van-icon name="arrow-left" /> {{ t('visa.chooseAgain') }}
        </button>
        <h2>{{ t('visa.basicInfo', { goal: goalInfo ? t(`visa.goals.${goalInfo.id}`) : '' }) }}</h2>
        <p class="visa-setup__note">{{ t('visa.setupNote') }}</p>

        <div class="visa-field">
          <span class="visa-field__label">{{ t('visa.subclass') }}</span>
          <van-radio-group v-model="form.subclass" direction="horizontal">
            <van-radio name="417">417</van-radio>
            <van-radio name="462">462</van-radio>
          </van-radio-group>
        </div>
        <div class="visa-field">
          <span class="visa-field__label">{{ t('visa.currentStage') }}</span>
          <van-radio-group v-model="form.stage" class="visa-field__stack">
            <van-radio v-for="stage in VISA_STAGES" :key="stage.id" :name="stage.id">{{
              t(`visa.stages.${stage.id}`)
            }}</van-radio>
          </van-radio-group>
        </div>
        <van-field v-model="form.stayUntil" type="date" label="Stay until" label-width="8.5em" required />
        <van-field v-model="form.workStart" type="date" :label="t('visa.workStart')" label-width="8.5em" required />
        <p class="visa-setup__hint">{{ t('visa.workStartHint') }}</p>
        <van-cell center :title="t('visa.alreadyStarted')">
          <template #right-icon>
            <van-switch v-model="form.started" size="22px" :aria-label="t('visa.alreadyStarted')" />
          </template>
        </van-cell>
        <p class="visa-setup__disclaimer">
          {{ t('visa.setupDisclaimer') }}
        </p>
        <van-button block type="primary" class="visa-setup__primary" :loading="saving" @click="save"
          >{{ t('visa.saveAndTrack') }}</van-button
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

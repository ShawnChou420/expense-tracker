<script setup>
import { useI18n } from 'vue-i18n'
// 設定未完成時的提示：不執行自動排班或試算，也絕不改用任何預設費率。
defineProps({
  show: Boolean,
  // 'pay'：還沒有確認費率；'schedule'：費率好了，還沒設定班別
  needs: { type: String, default: 'pay' },
  pendingLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:show', 'upload-payslip', 'manual', 'schedule'])
const { t } = useI18n()
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    safe-area-inset-bottom
    @update:show="emit('update:show', $event)"
  >
    <div class="gate">
      <span class="gate__icon" aria-hidden="true">
        <van-icon :name="needs === 'pay' ? 'balance-o' : 'clock-o'" />
      </span>
      <h2>{{ t('gate.title') }}</h2>
      <p v-if="needs === 'pay'">
        {{ t('gate.needsPay') }}
      </p>
      <p v-else>{{ t('gate.needsSchedule') }}</p>
      <p v-if="pendingLabel" class="gate__pending">
        <van-icon name="replay" aria-hidden="true" />{{ t('gate.continueAfter', { action: pendingLabel }) }}
      </p>
      <template v-if="needs === 'pay'">
        <van-button type="primary" block class="gate__button" icon="description-o" @click="emit('upload-payslip')">
          {{ t('gate.uploadPayslip') }}
        </van-button>
        <van-button plain type="primary" block class="gate__button" @click="emit('manual')">
          {{ t('gate.manualRates') }}
        </van-button>
      </template>
      <van-button v-else type="primary" block class="gate__button" icon="clock-o" @click="emit('schedule')">
        {{ t('payrollPage.setShifts') }}
      </van-button>
      <button type="button" class="gate__later" @click="emit('update:show', false)">{{ t('gate.later') }}</button>
    </div>
  </van-popup>
</template>

<style scoped>
.gate {
  padding: 26px 22px 18px;
  text-align: center;
}
.gate__icon {
  display: inline-grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 18px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 28px;
}
.gate h2 {
  margin: 14px 0 8px;
  color: var(--color-heading);
  font-size: 20px;
  font-weight: 800;
}
.gate p {
  margin: 0 auto;
  max-width: 340px;
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.6;
}
.gate .gate__pending {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  margin-top: 12px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 12px;
  font-weight: 700;
}
.gate__button {
  height: var(--page-button-height);
  margin-top: 12px;
  border-radius: var(--radius-button);
  font-weight: 700;
}
.gate__button:first-of-type {
  margin-top: 20px;
}
.gate__later {
  min-height: var(--touch-target);
  margin-top: 6px;
  padding: 0 16px;
  border: 0;
  background: none;
  color: var(--color-muted);
  font: inherit;
  font-size: 14px;
}
</style>

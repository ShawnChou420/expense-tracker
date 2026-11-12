<script setup>
// 首頁「最近一期薪資」：匯入薪資單後立刻看到這一期實際賺了多少。
import { computed, ref } from 'vue'
import { formatAud } from '../domain/money.js'
import { PAY_ITEM_LABELS } from '../domain/payslip/classify.js'
import { getPayslipHighlights } from '../domain/payslip/summary.js'

const props = defineProps({
  payslip: { type: Object, required: true },
  scheduleReady: Boolean,
  isMember: Boolean,
})
const emit = defineEmits(['setup-schedule', 'open-payroll', 'import-payslip'])
const detailsOpen = ref(false)

const highlights = computed(() => getPayslipHighlights(props.payslip))
const shortDate = (date) => (date ? date.slice(5).replace('-', '/') : '')
const periodLabel = computed(() => {
  const { periodStart, periodEnd } = props.payslip
  if (periodStart && periodEnd) return `${shortDate(periodStart)} – ${shortDate(periodEnd)}`
  return ''
})
const withholdingPercent = computed(() => {
  const { grossCents, taxCents } = props.payslip
  if (!grossCents || taxCents === null || taxCents === undefined) return null
  return Math.round((taxCents / grossCents) * 1000) / 10
})
const items = computed(() =>
  (props.payslip.items || []).filter((item) => item.amountCents !== null && item.amountCents !== undefined),
)
</script>

<template>
  <section class="latest-pay app-page__card" aria-labelledby="latest-pay-title">
    <header class="latest-pay__head">
      <span class="latest-pay__icon" aria-hidden="true"><van-icon name="balance-list-o" /></span>
      <div>
        <h2 id="latest-pay-title">最近一期薪資</h2>
        <p>
          {{ payslip.employerName || '薪資單' }} · 付款日 {{ shortDate(payslip.payDate) }}
        </p>
      </div>
      <span class="latest-pay__badge">{{ isMember ? '已保存' : '本次開啟' }}</span>
    </header>

    <div class="latest-pay__amount">
      <small>實領 Net Pay</small>
      <strong>{{ formatAud(payslip.netCents) }}</strong>
      <span v-if="periodLabel">工作期間 {{ periodLabel }}</span>
    </div>

    <dl class="latest-pay__grid">
      <div>
        <dt>稅前 Gross</dt>
        <dd>{{ payslip.grossCents === null ? '—' : formatAud(payslip.grossCents) }}</dd>
      </div>
      <div>
        <dt>預扣 PAYG{{ withholdingPercent !== null ? ` · ${withholdingPercent}%` : '' }}</dt>
        <dd>{{ payslip.taxCents === null ? '—' : formatAud(payslip.taxCents) }}</dd>
      </div>
      <div>
        <dt>工時</dt>
        <dd>{{ highlights.hours === null ? '—' : `${highlights.hours} 小時` }}</dd>
      </div>
      <div>
        <dt>平均每小時稅前</dt>
        <dd>{{ highlights.effectiveHourlyCents === null ? '—' : formatAud(highlights.effectiveHourlyCents) }}</dd>
      </div>
    </dl>
    <p v-if="payslip.superCents" class="latest-pay__super">
      另有 Super {{ formatAud(payslip.superCents) }} 存入退休金帳戶（不計入實領）
    </p>

    <button
      v-if="items.length"
      type="button"
      class="latest-pay__toggle"
      :aria-expanded="detailsOpen"
      @click="detailsOpen = !detailsOpen"
    >
      {{ detailsOpen ? '收起明細' : `查看 ${items.length} 個薪資項目` }}
      <van-icon :name="detailsOpen ? 'arrow-up' : 'arrow-down'" aria-hidden="true" />
    </button>
    <ul v-if="detailsOpen" class="latest-pay__items">
      <li v-for="item in items" :key="item.rawName">
        <span>
          <strong>{{ PAY_ITEM_LABELS[item.type] || item.rawName }}</strong>
          <small>{{ item.rawName }}{{ item.hours ? ` · ${item.hours} 小時 × $${item.rate}` : '' }}</small>
        </span>
        <b>{{ formatAud(item.amountCents) }}</b>
      </li>
    </ul>

    <div class="latest-pay__actions">
      <van-button
        v-if="!scheduleReady"
        type="primary"
        block
        icon="clock-o"
        class="latest-pay__cta"
        @click="emit('setup-schedule')"
      >
        設定班別，預估下一期
      </van-button>
      <van-button v-else type="primary" plain block icon="calendar-o" class="latest-pay__cta" @click="emit('open-payroll')">
        對照本週班表
      </van-button>
      <button type="button" class="latest-pay__link" @click="emit('import-payslip')">
        <van-icon name="add-o" />上傳新的薪資單
      </button>
    </div>
  </section>
</template>

<style scoped>
.latest-pay {
  padding: 18px;
  border-radius: var(--page-card-radius);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}
.latest-pay__head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.latest-pay__head > div {
  flex: 1;
  min-width: 0;
}
.latest-pay__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--color-income-soft);
  color: var(--color-income);
  font-size: 21px;
}
.latest-pay__head h2 {
  margin: 0;
  color: var(--color-heading);
  font-size: 16px;
  font-weight: 800;
}
.latest-pay__head p {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--color-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.latest-pay__badge {
  flex: none;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--color-background);
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
}
.latest-pay__amount {
  display: grid;
  gap: 2px;
  margin: 16px 0 14px;
}
.latest-pay__amount small {
  color: var(--color-muted);
  font-size: 12px;
}
.latest-pay__amount strong {
  color: var(--color-income);
  font-size: var(--font-amount);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.latest-pay__amount span {
  color: var(--color-heading);
  font-size: 13px;
  font-weight: 600;
}
.latest-pay__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.latest-pay__grid div {
  padding: 10px 12px;
  border-radius: var(--radius-medium);
  background: var(--color-background);
}
.latest-pay__grid dt {
  color: var(--color-muted);
  font-size: 11px;
}
.latest-pay__grid dd {
  margin: 2px 0 0;
  color: var(--color-heading);
  font-size: 15px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.latest-pay__super {
  margin: 10px 2px 0;
  color: var(--color-muted);
  font-size: 12px;
}
.latest-pay__toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  min-height: var(--touch-target);
  margin-top: 8px;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}
.latest-pay__items {
  margin: 0;
  padding: 0 2px;
  list-style: none;
}
.latest-pay__items li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 44px;
  font-size: 13px;
}
.latest-pay__items li + li {
  border-top: 1px solid var(--color-border);
}
.latest-pay__items span {
  display: grid;
  min-width: 0;
}
.latest-pay__items strong {
  color: var(--color-heading);
}
.latest-pay__items small {
  overflow: hidden;
  color: var(--color-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.latest-pay__items b {
  color: var(--color-heading);
  font-variant-numeric: tabular-nums;
}
.latest-pay__actions {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}
.latest-pay__cta {
  height: var(--page-button-height);
  border-radius: var(--radius-button);
  font-weight: 700;
}
.latest-pay__link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: var(--touch-target);
  border: 0;
  background: none;
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
}
</style>

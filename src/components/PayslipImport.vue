<script setup>
// 薪資單匯入：選檔 →（需要時）輸入密碼 → 在裝置上解析 → 使用者確認 → 才套用費率／記錄入帳。
// PDF 與密碼只存在這個元件的記憶體裡，關閉時清除，不上傳、不寫入 log。
import { computed, ref, watch } from 'vue'
import { formatAud } from '../domain/money.js'
import { PAY_ITEM_LABELS } from '../domain/payslip/classify.js'
import { parsePayslipLines, validatePayslip } from '../domain/payslip/parsePayslip.js'
import { getRateProposals, getRatesToApply } from '../domain/payslip/rates.js'
import {
  MAX_PAYSLIP_BYTES,
  PayslipPasswordError,
  fingerprintFile,
  readPayslipPdf,
} from '../services/payslipPdf.js'

const props = defineProps({
  show: Boolean,
  currentRates: { type: Object, required: true },
  rateSources: { type: Object, default: () => ({}) },
  isMember: Boolean,
  existingDeposits: { type: Array, default: null },
  firstTime: Boolean,
})
const emit = defineEmits(['update:show', 'apply', 'manual'])

const step = ref('choose') // choose | password | reading | review | noText | error
const errorMessage = ref('')
const imageNotice = ref(false)
const password = ref('')
const passwordError = ref('')
const activeTab = ref('summary')
let fileBuffer = null
let fileHash = null

const payslip = ref(null)
const form = ref({})
const items = ref([])
const selectedRateKeys = ref([])
const editedRates = ref({})
const recordDeposit = ref(true)

function reset() {
  step.value = 'choose'
  errorMessage.value = ''
  imageNotice.value = false
  password.value = ''
  passwordError.value = ''
  activeTab.value = 'summary'
  fileBuffer = null
  fileHash = null
  payslip.value = null
  form.value = {}
  items.value = []
  selectedRateKeys.value = []
  editedRates.value = {}
  recordDeposit.value = true
}
watch(
  () => props.show,
  (show) => {
    if (!show) reset()
  },
)

const close = () => emit('update:show', false)

async function onPdfSelected(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  imageNotice.value = false
  if (file.size > MAX_PAYSLIP_BYTES) {
    errorMessage.value = '檔案超過 5MB，請確認是單一薪資單 PDF'
    step.value = 'error'
    return
  }
  if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    errorMessage.value = '請選擇 PDF 檔案'
    step.value = 'error'
    return
  }
  fileBuffer = await file.arrayBuffer()
  fileHash = await fingerprintFile(fileBuffer)
  await readFile()
}

function onImageSelected(event) {
  event.target.value = ''
  imageNotice.value = true
}

async function readFile(withPassword) {
  if (!fileBuffer) return
  step.value = 'reading'
  try {
    const result = await readPayslipPdf(fileBuffer, withPassword)
    password.value = ''
    if (!result.hasText) {
      step.value = 'noText'
      return
    }
    loadParsed(parsePayslipLines(result.lines))
  } catch (error) {
    if (error instanceof PayslipPasswordError) {
      passwordError.value = error.reason === 'WRONG_PASSWORD' ? error.message : ''
      step.value = 'password'
      return
    }
    errorMessage.value = error.message || '讀取失敗，請再試一次'
    step.value = 'error'
  }
}

function submitPassword() {
  if (!password.value) {
    passwordError.value = '請輸入 PDF 開啟密碼'
    return
  }
  readFile(password.value)
}

const centsToInput = (cents) => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2))
const inputToCents = (value) => {
  const number = Number(value)
  return value === '' || !Number.isFinite(number) ? null : Math.round(number * 100)
}

function loadParsed(parsed) {
  payslip.value = parsed
  form.value = {
    employer: parsed.employer.name,
    payDate: parsed.payDate || '',
    periodStart: parsed.periodStart || '',
    periodEnd: parsed.periodEnd || '',
    gross: centsToInput(parsed.grossCents),
    tax: centsToInput(parsed.taxCents),
    net: centsToInput(parsed.netCents),
    super: centsToInput(parsed.superCents),
  }
  items.value = parsed.items.map((item) => ({ ...item }))
  const rows = getRateProposals(parsed, props.currentRates, props.rateSources)
  selectedRateKeys.value = rows
    .filter((row) => row.status === 'NEW' || row.status === 'CHANGED')
    .map((row) => row.key)
  recordDeposit.value = props.isMember && !duplicate.value
  step.value = 'review'
}

// 使用者修正後的資料（金額、項目分類）即時重新比對
const reviewed = computed(() => {
  if (!payslip.value) return null
  return {
    ...payslip.value,
    payDate: form.value.payDate || null,
    periodStart: form.value.periodStart || null,
    periodEnd: form.value.periodEnd || null,
    grossCents: inputToCents(form.value.gross),
    taxCents: inputToCents(form.value.tax),
    netCents: inputToCents(form.value.net),
    superCents: inputToCents(form.value.super),
    items: items.value,
  }
})
const warnings = computed(() => (reviewed.value ? validatePayslip(reviewed.value) : []))
const proposals = computed(() =>
  reviewed.value ? getRateProposals(reviewed.value, props.currentRates, props.rateSources) : [],
)
const unknownItems = computed(() => items.value.filter((item) => item.type === 'UNKNOWN'))
const lowConfidenceItems = computed(() =>
  items.value.filter((item) => item.type !== 'UNKNOWN' && item.confidence === 'LOW'),
)
const needsReview = computed(
  () => warnings.value.length > 0 || unknownItems.value.length > 0 || lowConfidenceItems.value.length > 0,
)
const reviewCount = computed(
  () => warnings.value.length + unknownItems.value.length + lowConfidenceItems.value.length,
)

const duplicate = computed(() => {
  const deposits = props.existingDeposits || []
  if (!reviewed.value) return null
  if (fileHash && deposits.some((deposit) => deposit.sourceRef === `payslip:${fileHash}`)) {
    return '這份薪資單之前已經匯入過'
  }
  const similar = deposits.find(
    (deposit) =>
      deposit.paidAt === reviewed.value.payDate && deposit.amountCents === reviewed.value.netCents,
  )
  return similar ? `已有一筆 ${similar.paidAt} 實領 ${formatAud(similar.amountCents)} 的入帳，可能重複` : null
})

const statusLabels = {
  NEW: '新發現',
  SAME: '與目前相同',
  CHANGED: '與目前不同',
  NOT_OBSERVED: '尚未出現',
}
const typeOptions = Object.entries(PAY_ITEM_LABELS)

function formatRateValue(row, value) {
  if (value === null || value === undefined) return '—'
  if (row.key === 'withholdingTaxRate') return `${Math.round(value * 10000) / 100}%`
  if (row.unit === '／週') return `$${Number(value).toFixed(2)}`
  // 時薪最多顯示 4 位小數，至少 2 位：28.0100 → 28.01、7.0025 → 7.0025
  const [whole, decimals = ''] = Number(value).toFixed(4).split('.')
  return `$${whole}.${decimals.replace(/0+$/, '').padEnd(2, '0')}`
}
function proposedValue(row) {
  return editedRates.value[row.key] ?? row.proposed
}
function editRate(row, value) {
  const number = Number(value)
  if (value === '' || !Number.isFinite(number) || number < 0) return
  editedRates.value = {
    ...editedRates.value,
    [row.key]: row.key === 'withholdingTaxRate' ? number / 100 : number,
  }
}
function toggleRate(key, checked) {
  selectedRateKeys.value = checked
    ? [...new Set([...selectedRateKeys.value, key])]
    : selectedRateKeys.value.filter((item) => item !== key)
}
function setItemType(item, type) {
  item.type = type
  item.confidence = 'HIGH'
  item.userConfirmed = true
}

const canConfirm = computed(
  () =>
    reviewed.value &&
    (selectedRateKeys.value.length > 0 || (recordDeposit.value && props.isMember)) &&
    (!recordDeposit.value ||
      (reviewed.value.payDate && reviewed.value.netCents !== null && reviewed.value.netCents >= 0)),
)

function confirmImport() {
  if (!canConfirm.value) return
  const applicable = getRatesToApply(
    proposals.value.map((row) => ({ ...row, proposed: proposedValue(row) })),
  )
  const rates = Object.fromEntries(
    Object.entries(applicable).filter(([key]) => selectedRateKeys.value.includes(key)),
  )
  const data = reviewed.value
  const deposit =
    recordDeposit.value && props.isMember
      ? {
          paidAt: data.payDate,
          amountCents: data.netCents,
          grossCents: data.grossCents,
          taxCents: data.taxCents,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          sourceRef: fileHash ? `payslip:${fileHash}` : null,
        }
      : null
  const employerYtd =
    data.ytd?.grossCents !== null && data.ytd?.grossCents !== undefined
      ? { grossCents: data.ytd.grossCents, taxCents: data.ytd.taxCents, payDate: data.payDate }
      : null
  emit('apply', { rates, deposit, employerYtd })
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    safe-area-inset-bottom
    class="payslip-sheet"
    @update:show="emit('update:show', $event)"
  >
    <div class="payslip">
      <header class="payslip__header">
        <h2>{{ step === 'review' ? '確認薪資單內容' : '匯入薪資單' }}</h2>
        <button type="button" class="payslip__close" aria-label="關閉" @click="close">
          <van-icon name="cross" />
        </button>
      </header>

      <!-- 選擇檔案 -->
      <section v-if="step === 'choose'" class="payslip__body">
        <p class="payslip__lead">
          {{ firstTime ? '讓第一張薪資單，幫你開始記帳。' : '上傳新的薪資單，更新費率與收入紀錄。' }}
        </p>
        <p class="payslip__sub">
          自動讀出時薪、各項加給、扣稅比例與年度累計。確認後才會套用，不會自動入帳。
        </p>
        <div class="payslip__options">
          <label class="payslip__option payslip__option--primary">
            <input type="file" accept="application/pdf,.pdf" @change="onPdfSelected" />
            <van-icon name="description-o" aria-hidden="true" />
            <span><strong>上傳 PDF</strong><small>支援有密碼的 PDF</small></span>
          </label>
          <label class="payslip__option">
            <input type="file" accept="image/*" @change="onImageSelected" />
            <van-icon name="photo-o" aria-hidden="true" />
            <span><strong>上傳圖片</strong><small>照片或截圖</small></span>
          </label>
          <button type="button" class="payslip__option" @click="emit('manual')">
            <van-icon name="edit" aria-hidden="true" />
            <span><strong>手動設定</strong><small>自己輸入時薪與加給</small></span>
          </button>
        </div>
        <p v-if="imageNotice" class="payslip__notice">
          圖片辨識（OCR）會在下一版推出。請先用雇主寄來的 PDF，或改用手動設定。
        </p>
        <p class="payslip__privacy">
          <van-icon name="shield-o" aria-hidden="true" />
          PDF 與密碼只在你的手機上讀取，不會上傳到伺服器，也不會被保存。
        </p>
      </section>

      <!-- 密碼 -->
      <section v-else-if="step === 'password'" class="payslip__body">
        <p class="payslip__lead">這份 PDF 有密碼保護</p>
        <p class="payslip__sub">輸入雇主提供的 PDF 開啟密碼。密碼只用來在手機上解鎖，不會被保存。</p>
        <form @submit.prevent="submitPassword">
          <van-field
            v-model="password"
            type="password"
            label="PDF 密碼"
            placeholder="輸入密碼"
            autocomplete="off"
            :error-message="passwordError"
            autofocus
          />
          <div class="payslip__actions">
            <van-button plain block @click="reset">換一個檔案</van-button>
            <van-button type="primary" block native-type="submit">解鎖並讀取</van-button>
          </div>
        </form>
      </section>

      <!-- 讀取中 -->
      <section v-else-if="step === 'reading'" class="payslip__body payslip__center">
        <van-loading size="32px" vertical>正在手機上讀取薪資單…</van-loading>
      </section>

      <!-- 沒有文字層 -->
      <section v-else-if="step === 'noText' || step === 'error'" class="payslip__body">
        <p class="payslip__lead">{{ step === 'noText' ? '無法讀出文字' : '讀取失敗' }}</p>
        <p class="payslip__sub">
          {{
            step === 'noText'
              ? '這份 PDF 沒有文字層（可能是掃描檔或照片），需要等下一版的圖片辨識。可以先手動設定費率。'
              : errorMessage
          }}
        </p>
        <div class="payslip__actions">
          <van-button plain block @click="reset">換一個檔案</van-button>
          <van-button type="primary" block @click="emit('manual')">手動設定</van-button>
        </div>
      </section>

      <!-- 確認 -->
      <section v-else-if="step === 'review' && reviewed" class="payslip__review">
        <p v-if="duplicate" class="payslip__duplicate">
          <van-icon name="warning-o" aria-hidden="true" />{{ duplicate }}
        </p>
        <van-tabs v-model:active="activeTab" shrink>
          <van-tab name="summary" title="薪資摘要">
            <div class="payslip__hero">
              <span>本次實領 Net Pay</span>
              <strong>{{ reviewed.netCents === null ? '—' : formatAud(reviewed.netCents) }}</strong>
              <small>
                {{ form.employer || '雇主未辨識' }} · 付款日 {{ form.payDate || '未辨識' }}
              </small>
              <div class="payslip__hero-items">
                <span><small>稅前 Gross</small><b>{{ reviewed.grossCents === null ? '—' : formatAud(reviewed.grossCents) }}</b></span>
                <span><small>扣稅 PAYG</small><b>{{ reviewed.taxCents === null ? '—' : formatAud(reviewed.taxCents) }}</b></span>
              </div>
            </div>
            <van-cell-group inset class="payslip__fields">
              <van-field v-model="form.payDate" label="付款日期" type="date" />
              <van-field v-model="form.periodStart" label="薪資期間起" type="date" />
              <van-field v-model="form.periodEnd" label="薪資期間迄" type="date" />
              <van-field v-model="form.gross" label="稅前 Gross" type="number" input-align="right" />
              <van-field v-model="form.tax" label="扣稅 PAYG" type="number" input-align="right" />
              <van-field v-model="form.net" label="實領 Net" type="number" input-align="right" />
              <van-field v-model="form.super" label="Super（另計）" type="number" input-align="right" />
            </van-cell-group>
            <div v-if="reviewed.ytd && reviewed.ytd.grossCents !== null" class="payslip__ytd">
              <h3>財年累計（雇主 YTD）</h3>
              <p>
                稅前 <b>{{ formatAud(reviewed.ytd.grossCents) }}</b>
                <template v-if="reviewed.ytd.taxCents !== null"> · 扣稅 <b>{{ formatAud(reviewed.ytd.taxCents) }}</b></template>
                <template v-if="reviewed.ytd.superCents !== null"> · Super <b>{{ formatAud(reviewed.ytd.superCents) }}</b></template>
              </p>
              <small>會用來更新首頁的年度稅務進度；不會和其他入帳重複相加。Super 存入退休金帳戶，不計入實領。</small>
            </div>
          </van-tab>

          <van-tab name="rates" title="工作費率">
            <p class="payslip__hint">勾選的費率會套用到薪資設定。舊班表的金額不會改變。</p>
            <ul class="rate-list">
              <li v-for="row in proposals" :key="row.key" class="rate-row" :class="`rate-row--${row.status}`">
                <div class="rate-row__top">
                  <van-checkbox
                    v-if="row.status !== 'NOT_OBSERVED'"
                    :model-value="selectedRateKeys.includes(row.key)"
                    shape="square"
                    icon-size="18px"
                    @update:model-value="toggleRate(row.key, $event)"
                  />
                  <span class="rate-row__name">
                    <strong>{{ row.label }}</strong>
                    <small>{{ row.sourceName || '這張薪資單沒有這個項目' }}</small>
                  </span>
                  <em class="rate-row__status">{{ statusLabels[row.status] }}</em>
                </div>
                <div class="rate-row__values">
                  <span>目前 {{ formatRateValue(row, row.current) }}</span>
                  <template v-if="row.status !== 'NOT_OBSERVED'">
                    <van-icon name="arrow" aria-hidden="true" />
                    <input
                      class="rate-row__input"
                      type="number"
                      step="any"
                      inputmode="decimal"
                      :aria-label="`${row.label} 新費率`"
                      :value="row.key === 'withholdingTaxRate' ? Math.round(proposedValue(row) * 10000) / 100 : proposedValue(row)"
                      @change="editRate(row, $event.target.value)"
                    />
                    <span>{{ row.key === 'withholdingTaxRate' ? '%' : row.unit }}</span>
                  </template>
                  <span v-else class="rate-row__keep">保留目前設定，不會設為 0</span>
                </div>
                <p v-if="row.warning" class="rate-row__warning">{{ row.warning }}</p>
              </li>
            </ul>
            <p class="payslip__hint">
              扣稅比率是本次 Tax ÷ Gross。WHM 採級距制，超過第一級距後比例會改變。
            </p>
          </van-tab>

          <van-tab v-if="needsReview" name="review" :title="`需要確認（${reviewCount}）`">
            <ul v-if="warnings.length" class="review-list">
              <li v-for="warning in warnings" :key="warning">
                <van-icon name="warning-o" aria-hidden="true" />{{ warning }}
              </li>
            </ul>
            <p v-if="warnings.length" class="payslip__hint">可以在「薪資摘要」直接修正金額。</p>
            <div
              v-for="item in [...unknownItems, ...lowConfidenceItems]"
              :key="item.rawName"
              class="unknown-item"
            >
              <strong>{{ item.rawName }}</strong>
              <small>
                {{ item.hours !== null ? `${item.hours} 小時 × $${item.rate}` : '固定金額' }} ＝
                {{ formatAud(item.amountCents ?? 0) }}
              </small>
              <label>
                這是哪一種？
                <select :value="item.type" @change="setItemType(item, $event.target.value)">
                  <option v-for="[value, label] in typeOptions" :key="value" :value="value">
                    {{ label }}
                  </option>
                </select>
              </label>
            </div>
          </van-tab>
        </van-tabs>

        <footer class="payslip__footer">
          <van-checkbox v-if="isMember" v-model="recordDeposit" shape="square" icon-size="18px">
            同時記錄這筆薪資入帳（實領 {{ reviewed.netCents === null ? '—' : formatAud(reviewed.netCents) }}）
          </van-checkbox>
          <p v-else class="payslip__guest">登入後可同時記錄薪資入帳；訪客模式只套用費率。</p>
          <van-button type="primary" block class="app-page__action" :disabled="!canConfirm" @click="confirmImport">
            確認並套用
          </van-button>
        </footer>
      </section>
    </div>
  </van-popup>
</template>

<style scoped>
.payslip-sheet {
  max-height: 92dvh;
}
.payslip {
  display: flex;
  flex-direction: column;
  max-height: 92dvh;
  background: var(--color-background);
}
.payslip__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 16px 8px 20px;
}
.payslip__header h2 {
  margin: 0;
  color: var(--color-heading);
  font-size: 20px;
  font-weight: 800;
}
.payslip__close {
  display: grid;
  place-items: center;
  width: var(--touch-target);
  height: var(--touch-target);
  border: 0;
  border-radius: 50%;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 18px;
}
.payslip__body {
  padding: 4px 20px 24px;
  overflow-y: auto;
}
.payslip__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.payslip__lead {
  margin: 4px 0 0;
  color: var(--color-heading);
  font-size: 18px;
  font-weight: 800;
}
.payslip__sub {
  margin: 6px 0 16px;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.55;
}
.payslip__options {
  display: grid;
  gap: 10px;
}
.payslip__option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 64px;
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--page-card-radius);
  background: var(--color-surface);
  color: var(--color-heading);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.payslip__option input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.payslip__option .van-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 21px;
}
.payslip__option--primary {
  border-color: var(--color-primary);
}
.payslip__option span {
  display: grid;
  gap: 2px;
}
.payslip__option strong {
  font-size: 15px;
}
.payslip__option small {
  color: var(--color-muted);
  font-size: 12px;
}
.payslip__notice {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: var(--radius-medium);
  background: var(--color-pending-soft);
  color: var(--color-pending);
  font-size: 13px;
  line-height: 1.5;
}
.payslip__privacy {
  display: flex;
  gap: 6px;
  margin: 16px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}
.payslip__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 16px;
}
.payslip__review {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.payslip__review :deep(.van-tabs) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.payslip__review :deep(.van-tabs__wrap) {
  position: sticky;
  top: 0;
  z-index: 1;
}
.payslip__duplicate {
  display: flex;
  gap: 6px;
  margin: 0 16px 8px;
  padding: 10px 12px;
  border-radius: var(--radius-medium);
  background: var(--color-pending-soft);
  color: var(--color-pending);
  font-size: 13px;
}
.payslip__hero {
  display: grid;
  gap: 4px;
  margin: 14px 16px 0;
  padding: 18px 20px;
  border-radius: var(--radius-hero);
  background: var(--color-primary);
  color: #fff;
}
.payslip__hero > span,
.payslip__hero > small {
  color: #e7f0fb;
  font-size: 13px;
}
.payslip__hero > strong {
  font-size: var(--font-amount);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.payslip__hero-items {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}
.payslip__hero-items span {
  display: grid;
}
.payslip__hero-items small {
  color: #e7f0fb;
  font-size: 12px;
}
.payslip__hero-items b {
  font-size: 17px;
}
.payslip__fields {
  margin-top: 12px;
}
.payslip__ytd {
  margin: 12px 16px 16px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--page-card-radius);
  background: var(--color-surface);
}
.payslip__ytd h3 {
  margin: 0;
  font-size: 15px;
}
.payslip__ytd p {
  margin: 6px 0;
  font-size: 14px;
}
.payslip__ytd small,
.payslip__hint {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}
.payslip__hint {
  margin: 12px 16px;
}
.rate-list,
.review-list {
  display: grid;
  gap: 8px;
  margin: 0 16px;
  padding: 0;
  list-style: none;
}
.rate-row {
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-surface);
}
.rate-row__top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rate-row__name {
  display: grid;
  flex: 1;
  min-width: 0;
}
.rate-row__name strong {
  font-size: 14px;
}
.rate-row__name small {
  overflow: hidden;
  color: var(--color-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rate-row__status {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2f7;
  color: var(--color-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}
.rate-row--NEW .rate-row__status {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.rate-row--SAME .rate-row__status {
  background: var(--color-income-soft);
  color: var(--color-income);
}
.rate-row--CHANGED .rate-row__status {
  background: var(--color-pending-soft);
  color: var(--color-pending);
}
.rate-row--NOT_OBSERVED {
  background: #f8fafc;
}
.rate-row__values {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  color: var(--color-muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.rate-row__input {
  width: 92px;
  min-height: 36px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  color: var(--color-heading);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
}
.rate-row__keep {
  font-size: 12px;
}
.rate-row__warning {
  margin: 6px 0 0;
  color: var(--color-pending);
  font-size: 12px;
}
.review-list {
  margin-top: 14px;
}
.review-list li {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-medium);
  background: var(--color-pending-soft);
  color: var(--color-pending);
  font-size: 13px;
  line-height: 1.45;
}
.unknown-item {
  display: grid;
  gap: 4px;
  margin: 10px 16px 0;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-surface);
}
.unknown-item small {
  color: var(--color-muted);
}
.unknown-item label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}
.unknown-item select {
  min-height: 36px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: #fff;
  font: inherit;
}
.payslip__footer {
  display: grid;
  gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.payslip__footer :deep(.van-checkbox__label) {
  color: var(--color-heading);
  font-size: 13px;
}
.payslip__guest {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
}
</style>

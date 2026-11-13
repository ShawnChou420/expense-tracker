<script setup>
// 工作設定精靈：Step 1 薪資費率 → Step 2 班別與每週排班 → Step 3 Smoko 與預覽 → 完成。
// 這裡只負責收集與顯示；保存、試算都交給 App（費率、計算引擎在那裡）。
import { computed, ref, watch } from 'vue'
import { formatAud } from '../domain/money.js'
import { RATE_FIELDS, getDefaultDerivedRate } from '../domain/payslip/rates.js'
import {
  LOADING_KEYS,
  PAY_STATUS,
  SHIFT_PRESETS,
  WEEKDAYS,
  createShiftTemplate,
  crossesMidnight,
  describeSmoko,
  describeWeekPlan,
} from '../domain/workProfile.js'
import { formatHours } from '../domain/home.js'

const props = defineProps({
  show: Boolean,
  step: { type: Number, default: 1 },
  // 直接打開手動輸入表單（例如薪資單讀不到時改手動設定）
  manual: Boolean,
  profile: { type: Object, required: true },
  // 目前保存的費率：{ baseRate, ppeAllowance, withholdingTaxRate, loadings: { key: value } }
  pay: { type: Object, required: true },
  latestPayslip: { type: Object, default: null },
  pendingAction: { type: Object, default: null },
  // (draftProfile) => { days: [...], summary } | null；用目前費率試算一週
  previewWeek: { type: Function, required: true },
  // 保存由 App 處理（回傳 Promise），成功後才前往下一步
  savePay: { type: Function, required: true },
  saveSchedule: { type: Function, required: true },
})
const emit = defineEmits(['update:show', 'upload-payslip', 'continue'])

// Vue 的 reactive proxy 不能用 structuredClone，設定都是純 JSON 資料
const clonePlain = (value) => JSON.parse(JSON.stringify(value))

const current = ref(1) // 1 | 2 | 3 | 4（完成）
const manualMode = ref(false)
const saving = ref(false)
const manual = ref({ baseRate: '', ppeAllowance: '', withholdingPercent: '', loadings: {}, allowProvisional: false })
const draft = ref({ shiftTemplates: [], weekPlan: {}, offDayRule: 'SKIP', smoko: { mode: 'AUTO', count: 1, minutes: 30, paid: false } })
const smokoChoice = ref('AUTO') // AUTO | 0 | 1 | 2 | CUSTOM

const payConfigured = computed(() => props.profile.payStatus !== PAY_STATUS.NOT_CONFIGURED && props.pay.baseRate > 0)
const steps = [
  { id: 1, label: '薪資' },
  { id: 2, label: '班別' },
  { id: 3, label: 'Smoko' },
]

function initialise() {
  current.value = props.step
  manualMode.value = props.manual && props.step === 1
  const loadings = {}
  for (const key of LOADING_KEYS) {
    if (props.profile.confirmedRateKeys.includes(key) && props.pay.loadings?.[key] != null) {
      loadings[key] = String(props.pay.loadings[key])
    }
  }
  manual.value = {
    baseRate: props.pay.baseRate > 0 ? String(props.pay.baseRate) : '',
    ppeAllowance: props.pay.ppeAllowance > 0 ? String(props.pay.ppeAllowance) : '',
    withholdingPercent:
      props.pay.withholdingTaxRate > 0 ? String(Math.round(props.pay.withholdingTaxRate * 10000) / 100) : '',
    loadings,
    allowProvisional: props.profile.allowProvisionalRates,
  }
  draft.value = clonePlain({
    shiftTemplates: props.profile.shiftTemplates,
    weekPlan: props.profile.weekPlan,
    offDayRule: props.profile.offDayRule,
    smoko: props.profile.smoko,
  })
  const { mode, count } = draft.value.smoko
  smokoChoice.value = mode === 'AUTO' ? 'AUTO' : count <= 2 ? String(count) : 'CUSTOM'
}
watch(
  () => props.show,
  (show) => {
    if (show) initialise()
  },
  { immediate: true },
)
// 薪資單匯入完成後 App 會把精靈帶到 Step 2
watch(
  () => props.step,
  (step) => {
    if (props.show) current.value = step
  },
)

const close = () => emit('update:show', false)

// ---------- Step 1：薪資 ----------
const loadingFields = RATE_FIELDS.filter((field) => LOADING_KEYS.includes(field.key))
const manualBase = computed(() => Number(manual.value.baseRate))
const manualErrors = computed(() => {
  const errors = {}
  if (!(manualBase.value > 0) || manualBase.value > 1000) errors.baseRate = '請輸入正確的基本時薪'
  const ppe = manual.value.ppeAllowance === '' ? 0 : Number(manual.value.ppeAllowance)
  if (!Number.isFinite(ppe) || ppe < 0) errors.ppeAllowance = '金額不正確'
  const tax = manual.value.withholdingPercent === '' ? 0 : Number(manual.value.withholdingPercent)
  if (!Number.isFinite(tax) || tax < 0 || tax > 60) errors.withholdingPercent = '請輸入 0–60 之間的百分比'
  for (const key of LOADING_KEYS) {
    const raw = manual.value.loadings[key]
    if (raw === undefined || raw === '') continue
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0 || value > 1000) errors[key] = '費率不正確'
  }
  return errors
})
const unfilledLoadings = computed(() =>
  loadingFields.filter((field) => (manual.value.loadings[field.key] ?? '') === ''),
)
const suggestion = (key) => {
  const value = manualBase.value > 0 ? getDefaultDerivedRate(key, manualBase.value) : null
  return value === null ? '' : `預設倍率約 $${value.toFixed(2)}`
}
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits

async function saveManualPay() {
  if (Object.keys(manualErrors.value).length) return
  const confirmed = {}
  for (const key of LOADING_KEYS) {
    const raw = manual.value.loadings[key]
    if (raw !== undefined && raw !== '') confirmed[key] = round(Number(raw), 4)
  }
  saving.value = true
  try {
    await props.savePay({
      baseRate: round(manualBase.value, 4),
      ppeAllowance: manual.value.ppeAllowance === '' ? 0 : round(Number(manual.value.ppeAllowance), 2),
      withholdingTaxRate:
        manual.value.withholdingPercent === '' ? 0 : round(Number(manual.value.withholdingPercent) / 100, 4),
      confirmed,
      allowProvisional: manual.value.allowProvisional,
    })
    manualMode.value = false
    current.value = 2
  } finally {
    saving.value = false
  }
}

const paySourceLabel = computed(() => {
  if (props.profile.payStatus === PAY_STATUS.PAYSLIP_CONFIRMED) {
    return props.latestPayslip ? `來自 ${props.latestPayslip.payDate} 的薪資單` : '來自薪資單'
  }
  return '手動設定'
})
const confirmedLoadingLabels = computed(() =>
  loadingFields.filter((field) => props.profile.confirmedRateKeys.includes(field.key)).map((field) => field.label),
)
const unconfirmedLoadingLabels = computed(() =>
  loadingFields.filter((field) => !props.profile.confirmedRateKeys.includes(field.key)).map((field) => field.label),
)

// ---------- Step 2：班別 ----------
const presetChoices = [...SHIFT_PRESETS.map((preset) => ({ ...preset })), { preset: 'CUSTOM', name: '自訂班別', startTime: '', endTime: '', cleaningStartTime: null, cleaningEndTime: null }]
const hasPreset = (preset) => draft.value.shiftTemplates.some((item) => item.preset === preset)
function togglePreset(choice) {
  if (choice.preset !== 'CUSTOM' && hasPreset(choice.preset)) {
    const template = draft.value.shiftTemplates.find((item) => item.preset === choice.preset)
    removeTemplate(template.id)
    return
  }
  const id = crypto.randomUUID().slice(0, 8)
  draft.value.shiftTemplates.push(
    createShiftTemplate(id, choice.preset === 'CUSTOM' ? { name: '自訂班別' } : choice),
  )
}
function removeTemplate(id) {
  draft.value.shiftTemplates = draft.value.shiftTemplates.filter((item) => item.id !== id)
  for (const { day } of WEEKDAYS) {
    if (draft.value.weekPlan[day] === id) draft.value.weekPlan[day] = null
  }
}
function setDay(day, templateId) {
  draft.value.weekPlan = { ...draft.value.weekPlan, [day]: templateId }
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const templateErrors = computed(() =>
  Object.fromEntries(
    draft.value.shiftTemplates.map((item) => [
      item.id,
      !item.name.trim()
        ? '請輸入班別名稱'
        : !TIME.test(item.startTime) || !TIME.test(item.endTime)
          ? '請選擇上下班時間'
          : item.startTime === item.endTime
            ? '上下班時間不能相同'
            : Boolean(item.cleaningStartTime) !== Boolean(item.cleaningEndTime)
              ? '清潔日的上下班時間要一起填，或都留空'
              : item.cleaningStartTime && item.cleaningStartTime === item.cleaningEndTime
                ? '清潔日上下班時間不能相同'
                : '',
    ]),
  ),
)
const workdayCount = computed(() => WEEKDAYS.filter(({ day }) => draft.value.weekPlan[day]).length)
const step2Problem = computed(() => {
  if (!draft.value.shiftTemplates.length) return '先選一個班別，或新增自訂班別'
  if (Object.values(templateErrors.value).some(Boolean)) return '請完成班別的名稱與時間'
  if (!workdayCount.value) return '選擇每週哪幾天上班'
  return ''
})
function shiftHours(template) {
  if (!TIME.test(template.startTime) || !TIME.test(template.endTime)) return ''
  const [sh, sm] = template.startTime.split(':').map(Number)
  const [eh, em] = template.endTime.split(':').map(Number)
  let minutes = eh * 60 + em - (sh * 60 + sm)
  if (minutes <= 0) minutes += 24 * 60
  return `共 ${formatHours(minutes)}`
}

// ---------- Step 3：Smoko 與預覽 ----------
const smokoOptions = [
  { value: 'AUTO', label: '自動' },
  { value: '0', label: '0 次' },
  { value: '1', label: '1 次' },
  { value: '2', label: '2 次' },
  { value: 'CUSTOM', label: '自訂' },
]
function chooseSmoko(value) {
  smokoChoice.value = value
  if (value === 'AUTO') draft.value.smoko.mode = 'AUTO'
  else {
    draft.value.smoko.mode = 'FIXED'
    if (value !== 'CUSTOM') draft.value.smoko.count = Number(value)
    else if (draft.value.smoko.count <= 2) draft.value.smoko.count = 3
  }
}
const draftProfile = computed(() => ({ ...props.profile, ...draft.value }))
const preview = computed(() => (current.value === 3 ? props.previewWeek(draftProfile.value) : null))

async function submitSchedule() {
  if (step2Problem.value) {
    current.value = 2
    return
  }
  saving.value = true
  try {
    await props.saveSchedule(clonePlain(draft.value))
    current.value = 4
  } finally {
    saving.value = false
  }
}

const doneSummary = computed(() => [
  ...describeWeekPlan(draftProfile.value),
  `Smoko：${describeSmoko(draft.value.smoko)}`,
])

function goTo(step) {
  if (step === 2 && !payConfigured.value) return
  if (step === 3 && step2Problem.value) return
  current.value = step
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    safe-area-inset-bottom
    class="setup-sheet"
    @update:show="emit('update:show', $event)"
  >
    <div class="setup">
      <header class="setup__header">
        <div>
          <span class="setup__eyebrow">工作設定</span>
          <h2>
            {{
              current === 1
                ? '設定薪資費率'
                : current === 2
                  ? '選擇你的班別'
                  : current === 3
                    ? 'Smoko 與預覽'
                    : '設定完成'
            }}
          </h2>
        </div>
        <button type="button" class="setup__close" aria-label="關閉" @click="close">
          <van-icon name="cross" />
        </button>
      </header>

      <ol v-if="current < 4" class="setup__steps" aria-label="設定進度">
        <li
          v-for="item in steps"
          :key="item.id"
          :class="{ 'is-active': current === item.id, 'is-done': current > item.id }"
        >
          <button type="button" :aria-current="current === item.id ? 'step' : undefined" @click="goTo(item.id)">
            <span class="setup__step-dot">
              <van-icon v-if="current > item.id" name="success" />
              <template v-else>{{ item.id }}</template>
            </span>
            {{ item.label }}
          </button>
        </li>
      </ol>

      <!-- Step 1 -->
      <section v-if="current === 1" class="setup__body">
        <template v-if="manualMode">
          <p class="setup__lead">輸入合約或薪資單上的費率</p>
          <p class="setup__sub">不確定的加給可以留白。</p>
          <van-cell-group inset class="setup__group">
            <van-field
              v-model="manual.baseRate"
              label="基本時薪"
              type="number"
              inputmode="decimal"
              placeholder="例如 30.00"
              input-align="right"
              required
              :error-message="manual.baseRate !== '' ? manualErrors.baseRate : ''"
            >
              <template #extra><span class="setup__unit">AUD／時</span></template>
            </van-field>
            <van-field
              v-model="manual.ppeAllowance"
              label="PPE 每週津貼"
              type="number"
              inputmode="decimal"
              placeholder="沒有就留白"
              input-align="right"
              :error-message="manualErrors.ppeAllowance"
            >
              <template #extra><span class="setup__unit">AUD／週</span></template>
            </van-field>
            <van-field
              v-model="manual.withholdingPercent"
              label="每期預扣比例"
              type="number"
              inputmode="decimal"
              placeholder="例如 15"
              input-align="right"
              :error-message="manualErrors.withholdingPercent"
            >
              <template #extra><span class="setup__unit">%</span></template>
            </van-field>
          </van-cell-group>
          <p class="setup__note">薪資單上 Tax ÷ Gross，用來估算每期實領。</p>

          <h3 class="setup__title">加給費率（選填）</h3>
          <van-cell-group inset class="setup__group">
            <van-field
              v-for="field in loadingFields"
              :key="field.key"
              v-model="manual.loadings[field.key]"
              :label="field.label"
              type="number"
              inputmode="decimal"
              :placeholder="suggestion(field.key) || '留白＝未確認'"
              input-align="right"
              :error-message="manualErrors[field.key]"
            >
              <template #extra><span class="setup__unit">{{ field.mode === 'FULL' ? '時薪' : '每小時加' }}</span></template>
            </van-field>
          </van-cell-group>
          <div v-if="unfilledLoadings.length" class="setup__provisional">
            <van-checkbox v-model="manual.allowProvisional" shape="square" icon-size="18px">
              未填寫的加給先用預設倍率暫估
            </van-checkbox>
            <p>
              {{ manual.allowProvisional ? '會標示「含未確認費率，僅供參考」。' : '不暫估就不計入。' }}
              未填：{{ unfilledLoadings.map((field) => field.label).join('、') }}
            </p>
          </div>
          <div class="setup__actions">
            <van-button plain block @click="manualMode = false">返回</van-button>
            <van-button
              type="primary"
              block
              :loading="saving"
              :disabled="Object.keys(manualErrors).length > 0"
              @click="saveManualPay"
            >
              儲存，下一步
            </van-button>
          </div>
        </template>

        <template v-else-if="payConfigured">
          <div class="pay-summary">
            <div class="pay-summary__head">
              <van-icon name="passed" aria-hidden="true" />
              <span>
                <strong>費率已確認</strong>
                <small>{{ paySourceLabel }}</small>
              </span>
            </div>
            <dl class="pay-summary__grid">
              <div><dt>基本時薪</dt><dd>${{ pay.baseRate.toFixed(2) }}</dd></div>
              <div><dt>PPE／週</dt><dd>${{ (pay.ppeAllowance || 0).toFixed(2) }}</dd></div>
              <div><dt>本期預扣比例</dt><dd>{{ Math.round((pay.withholdingTaxRate || 0) * 10000) / 100 }}%</dd></div>
            </dl>
            <p v-if="confirmedLoadingLabels.length" class="pay-summary__line">
              <van-icon name="success" aria-hidden="true" />已確認：{{ confirmedLoadingLabels.join('、') }}
            </p>
            <p v-if="unconfirmedLoadingLabels.length" class="pay-summary__line pay-summary__line--muted">
              <van-icon name="info-o" aria-hidden="true" />
              {{ profile.allowProvisionalRates ? '暫估' : '未計入' }}：{{ unconfirmedLoadingLabels.join('、') }}
            </p>
          </div>
          <div class="setup__secondary">
            <button type="button" @click="emit('upload-payslip')"><van-icon name="description-o" />上傳新的 Payslip</button>
            <button type="button" @click="manualMode = true"><van-icon name="edit" />手動修改</button>
          </div>
          <van-button type="primary" block class="setup__primary" @click="current = 2">下一步：選擇班別</van-button>
        </template>

        <template v-else>
          <p class="setup__lead">先告訴我你的時薪</p>
          <p class="setup__sub">設定後薪資預估才會準。</p>
          <button type="button" class="choice choice--primary" @click="emit('upload-payslip')">
            <span class="choice__icon"><van-icon name="description-o" /></span>
            <span class="choice__text">
              <strong>上傳 Payslip 自動設定費率</strong>
              <small>自動讀出時薪、加給和扣稅</small>
            </span>
            <van-icon name="arrow" />
          </button>
          <button type="button" class="choice" @click="manualMode = true">
            <span class="choice__icon"><van-icon name="edit" /></span>
            <span class="choice__text">
              <strong>手動設定費率</strong>
              <small>輸入時薪，加給之後再補</small>
            </span>
            <van-icon name="arrow" />
          </button>
        </template>
      </section>

      <!-- Step 2 -->
      <section v-else-if="current === 2" class="setup__body">
        <p class="setup__sub">
          點選常見班別加入，時間都可以改。
        </p>
        <div class="presets" role="group" aria-label="班別範本">
          <button
            v-for="choice in presetChoices"
            :key="choice.preset"
            type="button"
            class="preset"
            :class="{ 'is-selected': choice.preset !== 'CUSTOM' && hasPreset(choice.preset), 'preset--custom': choice.preset === 'CUSTOM' }"
            :aria-pressed="choice.preset !== 'CUSTOM' && hasPreset(choice.preset)"
            @click="togglePreset(choice)"
          >
            <van-icon
              :name="choice.preset === 'CUSTOM' ? 'plus' : hasPreset(choice.preset) ? 'checked' : 'circle'"
              class="preset__mark"
              aria-hidden="true"
            />
            <strong>{{ choice.name }}</strong>
            <small v-if="choice.preset !== 'CUSTOM'">
              {{ choice.startTime }}–{{ choice.endTime }}{{ crossesMidnight(choice) ? ' 隔天' : '' }}
            </small>
            <small v-else>自己設定時間</small>
          </button>
        </div>

        <template v-if="draft.shiftTemplates.length">
          <h3 class="setup__title">我的班別</h3>
          <article v-for="template in draft.shiftTemplates" :key="template.id" class="template">
            <div class="template__row">
              <input v-model="template.name" class="template__name" maxlength="20" aria-label="班別名稱" />
              <button type="button" class="template__remove" :aria-label="`移除${template.name}`" @click="removeTemplate(template.id)">
                <van-icon name="delete-o" />
              </button>
            </div>
            <div class="template__times">
              <label>
                <small>上班</small>
                <input v-model="template.startTime" type="time" step="300" />
              </label>
              <van-icon name="arrow" aria-hidden="true" />
              <label>
                <small>下班{{ crossesMidnight(template) && template.endTime ? '（隔天）' : '' }}</small>
                <input v-model="template.endTime" type="time" step="300" />
              </label>
            </div>
            <div class="template__meta">
              <span v-if="crossesMidnight(template) && template.startTime && template.endTime" class="tag tag--night">
                <van-icon name="moon-o" />跨午夜
              </span>
              <span v-if="shiftHours(template)" class="template__hours">{{ shiftHours(template) }}</span>
            </div>
            <!-- 清潔日不固定，不放進每週排班；當天在班表上標記清潔日時，自動換成這組時間 -->
            <div class="template__times template__times--cleaning">
              <label>
                <small>清潔日上班</small>
                <input v-model="template.cleaningStartTime" type="time" step="300" />
              </label>
              <van-icon name="arrow" aria-hidden="true" />
              <label>
                <small>清潔日下班</small>
                <input v-model="template.cleaningEndTime" type="time" step="300" />
              </label>
            </div>
            <p v-if="templateErrors[template.id]" class="template__error">{{ templateErrors[template.id] }}</p>
          </article>

          <h3 class="setup__title">每週哪幾天上班？</h3>
          <p class="setup__note">沒選的日子當休息。</p>
          <div class="week">
            <div v-for="weekday in WEEKDAYS" :key="weekday.day" class="week__row">
              <span class="week__day" :class="{ 'is-on': draft.weekPlan[weekday.day] }">{{ weekday.label }}</span>
              <div class="week__chips">
                <button
                  type="button"
                  class="chip"
                  :class="{ 'is-selected': !draft.weekPlan[weekday.day] }"
                  @click="setDay(weekday.day, null)"
                >
                  休息
                </button>
                <button
                  v-for="template in draft.shiftTemplates"
                  :key="template.id"
                  type="button"
                  class="chip"
                  :class="{ 'is-selected': draft.weekPlan[weekday.day] === template.id }"
                  @click="setDay(weekday.day, template.id)"
                >
                  {{ template.name }}
                </button>
              </div>
            </div>
          </div>
          <div class="setup__offday">
            <span>休息日</span>
            <van-radio-group v-model="draft.offDayRule" direction="horizontal">
              <van-radio name="SKIP" icon-size="18px">不建立紀錄</van-radio>
              <van-radio name="LEAVE" icon-size="18px">標記為休假</van-radio>
            </van-radio-group>
          </div>
        </template>

        <p v-if="step2Problem" class="setup__problem">{{ step2Problem }}</p>
        <div class="setup__actions">
          <van-button plain block @click="current = 1">上一步</van-button>
          <van-button type="primary" block :disabled="Boolean(step2Problem)" @click="current = 3">下一步</van-button>
        </div>
      </section>

      <!-- Step 3 -->
      <section v-else-if="current === 3" class="setup__body">
        <h3 class="setup__title setup__title--first">每班 Smoko 次數</h3>
        <div class="segmented" role="radiogroup" aria-label="Smoko 次數">
          <button
            v-for="option in smokoOptions"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="smokoChoice === option.value"
            :class="{ 'is-selected': smokoChoice === option.value }"
            @click="chooseSmoko(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <p class="setup__note">
          {{
            smokoChoice === 'AUTO'
              ? '滿 4 小時 1 次、滿 8 小時 2 次。'
              : '個別日子可以在當天另外調整。'
          }}
        </p>
        <van-cell-group inset class="setup__group">
          <van-cell v-if="smokoChoice === 'CUSTOM'" title="每班次數" center>
            <template #right-icon>
              <van-stepper v-model="draft.smoko.count" :min="0" :max="3" integer button-size="30px" />
            </template>
          </van-cell>
          <van-cell title="每次幾分鐘" center>
            <template #right-icon>
              <van-stepper v-model="draft.smoko.minutes" :min="5" :max="60" :step="5" integer button-size="30px" />
            </template>
          </van-cell>
          <van-cell center title="Smoko 照常計薪" label="關閉＝從工時扣除">
            <template #right-icon>
              <van-switch v-model="draft.smoko.paid" size="22px" />
            </template>
          </van-cell>
        </van-cell-group>

        <div v-if="preview" class="preview">
          <div class="preview__head">
            <span>以本週為例</span>
            <strong>{{ formatAud(preview.summary.grossCents) }}</strong>
            <small>{{ preview.summary.shiftCount }} 個班 · {{ formatHours(preview.summary.paidMinutes) }} · 預估稅前</small>
          </div>
          <ul class="preview__days">
            <li v-for="day in preview.days" :key="day.date" :class="{ 'is-off': !day.name }">
              <span class="preview__date">{{ day.weekday }}<small>{{ day.date.slice(5).replace('-', '/') }}</small></span>
              <span class="preview__shift">
                <template v-if="day.name">
                  <strong>{{ day.name }}</strong>
                  <small><span class="nowrap">{{ day.time }}</span> · <span class="nowrap">{{ formatHours(day.paidMinutes) }}</span></small>
                </template>
                <template v-else>{{ day.leave ? '休假' : '休息' }}</template>
              </span>
              <span class="preview__pay">{{ day.name ? formatAud(day.grossCents) : '' }}</span>
            </li>
          </ul>
          <p v-if="preview.summary.rateFlags.provisional.length" class="preview__flag">
            <van-icon name="info-o" />含未確認費率，僅供參考（{{ preview.summary.rateFlags.provisional.join('、') }}）
          </p>
          <p v-if="preview.summary.rateFlags.excluded.length" class="preview__flag preview__flag--warn">
            <van-icon name="warning-o" />未含 {{ preview.summary.rateFlags.excluded.join('、') }}（費率未確認）
          </p>
        </div>

        <div class="setup__actions">
          <van-button plain block @click="current = 2">上一步</van-button>
          <van-button type="primary" block :loading="saving" @click="submitSchedule">完成設定</van-button>
        </div>
      </section>

      <!-- 完成 -->
      <section v-else class="setup__body setup__done">
        <span class="setup__done-icon" aria-hidden="true"><van-icon name="success" /></span>
        <p class="setup__done-title">工作設定完成，現在可以開始預估薪資。</p>
        <ul class="setup__done-list">
          <li v-for="line in doneSummary" :key="line">{{ line }}</li>
        </ul>
        <p class="setup__note">之後可以在「薪資」頁修改。</p>
        <van-button v-if="pendingAction" type="primary" block class="setup__primary" @click="emit('continue', pendingAction)">
          繼續{{ pendingAction.label }}
        </van-button>
        <van-button v-else type="primary" block class="setup__primary" @click="emit('continue', null)">
          開始排班
        </van-button>
        <van-button plain block class="setup__later" @click="close">{{ pendingAction ? '稍後再說' : '完成' }}</van-button>
      </section>
    </div>
  </van-popup>
</template>

<style scoped>
.setup-sheet {
  max-height: 94dvh;
}
.setup {
  display: flex;
  flex-direction: column;
  max-height: 94dvh;
  background: var(--color-background);
}
.setup__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 14px 6px 20px;
}
.setup__eyebrow {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.setup__header h2 {
  margin: 2px 0 0;
  color: var(--color-heading);
  font-size: 21px;
  font-weight: 800;
}
.setup__close {
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
.setup__steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin: 6px 20px 4px;
  padding: 0;
  list-style: none;
}
.setup__steps li {
  position: relative;
}
.setup__steps button {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 36px;
  padding: 0;
  border: 0;
  border-bottom: 3px solid var(--color-border);
  background: none;
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}
.setup__steps .is-active button {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.setup__steps .is-done button {
  border-color: var(--color-income);
  color: var(--color-income);
}
.setup__step-dot {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-border);
  color: var(--color-muted);
  font-size: 11px;
}
.setup__steps .is-active .setup__step-dot {
  background: var(--color-primary);
  color: #fff;
}
.setup__steps .is-done .setup__step-dot {
  background: var(--color-income);
  color: #fff;
}
.setup__body {
  padding: 12px 20px 24px;
  overflow-y: auto;
}
.setup__lead {
  margin: 4px 0 0;
  color: var(--color-heading);
  font-size: 18px;
  font-weight: 800;
}
.setup__sub {
  margin: 6px 0 14px;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.55;
}
.setup__note {
  margin: 8px 2px 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}
.setup__title {
  margin: 22px 0 10px;
  color: var(--color-heading);
  font-size: 15px;
  font-weight: 800;
}
.setup__title--first {
  margin-top: 6px;
}
.setup__group {
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
}
.setup__unit {
  margin-left: 6px;
  color: var(--color-muted);
  font-size: 12px;
  white-space: nowrap;
}
.setup__provisional {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-medium);
  background: var(--color-pending-soft);
}
.setup__provisional p {
  margin: 6px 0 0 26px;
  color: var(--color-pending);
  font-size: 12px;
  line-height: 1.5;
}
.setup__actions {
  display: grid;
  grid-template-columns: 1fr 1.6fr;
  gap: 10px;
  margin-top: 22px;
}
.setup__actions :deep(.van-button),
.setup__primary,
.setup__later {
  height: var(--page-button-height);
  border-radius: var(--radius-button);
  font-weight: 700;
}
.setup__primary {
  margin-top: 18px;
}
.setup__later {
  margin-top: 10px;
}
.setup__problem {
  margin: 16px 0 0;
  color: var(--color-pending);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
}

.choice {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 76px;
  margin-bottom: 10px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-large);
  background: var(--color-surface);
  color: var(--color-heading);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.choice--primary {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}
.choice__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: 22px;
}
.choice--primary .choice__icon {
  background: var(--color-primary);
  color: #fff;
}
.choice__text {
  display: grid;
  flex: 1;
  gap: 3px;
}
.choice__text strong {
  font-size: 15px;
}
.choice__text small {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}

.pay-summary {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-large);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}
.pay-summary__head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pay-summary__head .van-icon {
  color: var(--color-income);
  font-size: 26px;
}
.pay-summary__head span {
  display: grid;
}
.pay-summary__head strong {
  color: var(--color-heading);
  font-size: 16px;
}
.pay-summary__head small {
  color: var(--color-muted);
  font-size: 12px;
}
.pay-summary__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 14px 0 6px;
}
.pay-summary__grid div {
  padding: 10px;
  border-radius: var(--radius-medium);
  background: var(--color-background);
}
.pay-summary__grid dt {
  color: var(--color-muted);
  font-size: 11px;
}
.pay-summary__grid dd {
  margin: 2px 0 0;
  color: var(--color-heading);
  font-size: 16px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.pay-summary__line {
  display: flex;
  gap: 6px;
  margin: 8px 0 0;
  color: var(--color-income);
  font-size: 12px;
  line-height: 1.5;
}
.pay-summary__line--muted {
  color: var(--color-pending);
}
.setup__secondary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
}
.setup__secondary button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--touch-target);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  background: var(--color-surface);
  color: var(--color-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}

.presets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.preset {
  position: relative;
  display: grid;
  gap: 2px;
  min-height: 72px;
  padding: 12px 12px 12px 14px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  color: var(--color-heading);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--motion-fast), background var(--motion-fast);
}
.preset strong {
  font-size: 15px;
}
.preset small {
  color: var(--color-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.preset__mark {
  position: absolute;
  top: 10px;
  right: 10px;
  color: var(--color-border);
  font-size: 18px;
}
.preset.is-selected {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}
.preset.is-selected .preset__mark {
  color: var(--color-primary);
}
.preset--custom {
  border-style: dashed;
}
.preset--custom .preset__mark {
  color: var(--color-primary);
}

.template {
  margin-bottom: 10px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-surface);
}
.template__row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.template__name {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-small);
  background: var(--color-background);
  color: var(--color-heading);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
}
.template__name:focus {
  border-color: var(--color-primary);
  outline: none;
}
.template__remove {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--color-muted);
  font-size: 18px;
}
.template__times {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: 8px;
  margin-top: 10px;
}
.template__times > .van-icon {
  margin-bottom: 13px;
  color: var(--color-muted);
}
.template__times label {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.template__times small {
  color: var(--color-muted);
  font-size: 12px;
}
.template__times input {
  width: 100%;
  min-height: 42px;
  box-sizing: border-box;
  min-width: 0;
  padding: 0 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-heading);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.template__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}
.tag--night {
  background: #eef0fb;
  color: #4b4fa8;
}
.template__hours {
  color: var(--color-muted);
  font-size: 12px;
}
.template__times--cleaning {
  padding-top: 10px;
  border-top: 1px dashed var(--color-border);
}
.template__times--cleaning input {
  font-weight: 600;
}
.template__error {
  margin: 8px 0 0;
  color: var(--color-expense);
  font-size: 12px;
}

.week {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-surface);
}
.week__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
}
.week__row + .week__row {
  border-top: 1px solid var(--color-border);
}
.week__day {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-background);
  color: var(--color-muted);
  font-size: 14px;
  font-weight: 800;
}
.week__day.is-on {
  background: var(--color-primary);
  color: #fff;
}
.week__chips {
  display: flex;
  flex: 1;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.chip {
  flex: none;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}
.chip.is-selected {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: #fff;
}
.setup__offday {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  font-size: 13px;
}
.setup__offday > span {
  color: var(--color-heading);
  font-weight: 700;
}

.segmented {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-medium);
  background: #e9eef5;
}
.segmented button {
  min-height: 38px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}
.segmented .is-selected {
  background: var(--color-surface);
  color: var(--color-primary);
  box-shadow: 0 1px 4px rgba(16, 42, 67, 0.12);
}
.segmented + .setup__note {
  margin-bottom: 12px;
}

.preview {
  margin-top: 18px;
  overflow: hidden;
  border-radius: var(--radius-large);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}
.preview__head {
  display: grid;
  gap: 2px;
  padding: 16px;
  background: var(--color-primary);
  color: #fff;
}
.preview__head span {
  font-size: 12px;
  opacity: 0.85;
}
.preview__head strong {
  font-size: 28px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.preview__head small {
  font-size: 12px;
  opacity: 0.85;
}
.preview__days {
  margin: 0;
  padding: 4px 14px;
  list-style: none;
}
.preview__days li {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  font-size: 13px;
}
.preview__days li + li {
  border-top: 1px solid var(--color-border);
}
.preview__days li.is-off {
  color: var(--color-muted);
}
.preview__date {
  display: grid;
  color: var(--color-heading);
  font-weight: 800;
}
.preview__date small {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 400;
}
.preview__shift {
  display: grid;
}
.preview__shift strong {
  color: var(--color-heading);
}
.preview__shift small {
  color: var(--color-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.nowrap {
  white-space: nowrap;
}
.preview__pay {
  color: var(--color-income);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.preview__flag {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 10px 14px;
  background: var(--color-pending-soft);
  color: var(--color-pending);
  font-size: 12px;
  line-height: 1.5;
}
.preview__flag--warn {
  background: #fdecec;
  color: var(--color-expense);
}

.setup__done {
  text-align: center;
}
.setup__done-icon {
  display: inline-grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-top: 8px;
  border-radius: 50%;
  background: var(--color-income-soft);
  color: var(--color-income);
  font-size: 34px;
}
.setup__done-title {
  margin: 14px 0 12px;
  color: var(--color-heading);
  font-size: 18px;
  font-weight: 800;
  line-height: 1.45;
}
.setup__done-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  color: var(--color-heading);
  font-size: 13px;
  line-height: 1.5;
  list-style: none;
  text-align: left;
}
</style>

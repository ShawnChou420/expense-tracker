<script setup>
// 補登歷史班表：選期間 → 預覽 → 修正請假與異常班次 → 確認保存。
// 依既有的班別、每週排班與 Smoko 設定產生草稿；已有紀錄的日期一律不動，使用者確認後才保存。
import { computed, ref, watch } from 'vue'
import { showToast } from 'vant'
import { LEAVE_TYPES, getLeaveType } from '../domain/leaveTypes.js'
import {
  MAX_HISTORY_DAYS,
  createHistoryDrafts,
  editHistoryDrafts,
  historyDraftsToRecords,
  summarizeHistoryDrafts,
  validateHistoryRange,
} from '../domain/historyImport.js'
import { formatHours } from '../domain/home.js'

const props = defineProps({
  show: Boolean,
  records: { type: Array, required: true },
  profile: { type: Object, required: true },
  /** (draft, id) => 班表紀錄；用既有薪資計算建立，時間無效時回傳 null */
  buildWork: { type: Function, required: true },
  nextId: { type: Function, required: true },
  defaultStart: { type: String, default: '' },
  today: { type: String, required: true },
  /** 保存（async），參數是要新增的紀錄 */
  submit: { type: Function, required: true },
})
const emit = defineEmits(['update:show', 'view-progress'])

const STEPS = ['選擇期間', '預覽班表', '修正請假', '確認保存']
const step = ref(0)
const start = ref('')
const end = ref('')
const drafts = ref(/** @type {import('../domain/historyImport.js').HistoryDraft[]} */ ([]))
const skippedExisting = ref(0)
const selected = ref(/** @type {string[]} */ ([]))
const saving = ref(false)
const savedCount = ref(0)

watch(
  () => props.show,
  (show) => {
    if (!show) return
    step.value = 0
    start.value = props.defaultStart || props.today
    end.value = props.today
    drafts.value = []
    selected.value = []
    savedCount.value = 0
  },
  { immediate: true },
)

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const dayLabel = (/** @type {string} */ date) => {
  const [y, m, d] = date.split('-').map(Number)
  return `${m}/${d}（${WEEKDAYS[new Date(y, m - 1, d).getDay()]}）`
}

// 每一個上班草稿用既有薪資計算試算，顯示工時與 Smoko
const preview = computed(() => {
  const map = new Map()
  for (const draft of drafts.value) {
    if (draft.kind === 'work') map.set(draft.date, props.buildWork(draft, 0))
  }
  return map
})
const summary = computed(() => summarizeHistoryDrafts(drafts.value))
const invalidCount = computed(
  () => drafts.value.filter((draft) => draft.kind === 'work' && !preview.value.get(draft.date)).length,
)
const totalHours = computed(() =>
  [...preview.value.values()].reduce((sum, record) => sum + (record?.paidMinutes || 0), 0),
)

/** 依月份分組，長清單比較好找 */
const groups = computed(() => {
  const result = []
  for (const draft of drafts.value) {
    const month = draft.date.slice(0, 7)
    let group = result.at(-1)
    if (!group || group.month !== month) {
      group = { month, label: `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`, items: [] }
      result.push(group)
    }
    group.items.push(draft)
  }
  return result
})

function rowDetail(draft) {
  if (draft.kind === 'rest') return '休息日（不保存）'
  if (draft.kind === 'leave') {
    const type = getLeaveType(draft.leaveType)
    return `${type?.label ?? '請假'}（無薪）`
  }
  const record = preview.value.get(draft.date)
  if (!record) return `${draft.startTime || '--'}–${draft.endTime || '--'} · 時間不完整`
  const smoko = draft.smokoMode === 'MANUAL' ? '手動' : '自動'
  return `${draft.startTime}–${draft.endTime} · ${formatHours(record.paidMinutes)} · Smoko ${record.smokoCount} 次（${smoko}）${draft.isCleaningDay ? ' · 清潔日' : ''}`
}

function goPreview() {
  const error = validateHistoryRange({ start: start.value, end: end.value, today: props.today })
  if (error) return showToast(error)
  const result = createHistoryDrafts({
    records: props.records,
    profile: props.profile,
    start: start.value,
    end: end.value,
  })
  drafts.value = result.drafts
  skippedExisting.value = result.skippedExisting
  selected.value = []
  step.value = 1
}

// --- 修正：多選後一次修改 ---
const isSelected = (date) => selected.value.includes(date)
function toggleSelect(date) {
  selected.value = isSelected(date)
    ? selected.value.filter((item) => item !== date)
    : [...selected.value, date]
}
function selectAllWork() {
  selected.value = drafts.value.filter((draft) => draft.kind === 'work').map((draft) => draft.date)
}

const actionsOpen = ref(false)
const bulkActions = [
  ...LEAVE_TYPES.map((type) => ({ name: `設為${type.label}`, patch: { kind: 'leave', leaveType: type.id } })),
  { name: '恢復上班（依排班）', patch: { kind: 'work' } },
  { name: '修改上下班時間與 Smoko', edit: true },
]
function onBulkAction(action) {
  actionsOpen.value = false
  if (action.edit) return openEditor(selected.value)
  drafts.value = editHistoryDrafts(drafts.value, selected.value, action.patch, props.profile)
  showToast(`已修改 ${selected.value.length} 天`)
  selected.value = []
}

// --- 單日／多日編輯 ---
const editorOpen = ref(false)
const editorDates = ref(/** @type {string[]} */ ([]))
const editor = ref({
  kind: 'work',
  leaveType: 'HOLIDAY',
  startTime: '',
  endTime: '',
  smokoMode: 'AUTO',
  smokoCount: 0,
  isCleaningDay: false,
})
const editorTitle = computed(() =>
  editorDates.value.length === 1 ? dayLabel(editorDates.value[0]) : `${editorDates.value.length} 天一起修改`,
)
const editorTemplate = computed(() => {
  const draft = drafts.value.find((item) => item.date === editorDates.value[0])
  return props.profile.shiftTemplates.find((item) => item.id === draft?.templateId) ?? null
})

function openEditor(dates) {
  if (!dates.length) return
  const first = drafts.value.find((draft) => draft.date === dates[0])
  editorDates.value = [...dates]
  editor.value = {
    kind: first.kind === 'rest' ? 'work' : first.kind,
    leaveType: first.leaveType || 'HOLIDAY',
    startTime: first.startTime,
    endTime: first.endTime,
    smokoMode: first.smokoMode,
    smokoCount: first.smokoCount ?? preview.value.get(first.date)?.smokoCount ?? 0,
    isCleaningDay: first.isCleaningDay,
  }
  editorOpen.value = true
}

function applyEditor() {
  const dates = editorDates.value
  const value = editor.value
  let next = drafts.value
  if (value.kind === 'leave') {
    next = editHistoryDrafts(next, dates, { kind: 'leave', leaveType: value.leaveType }, props.profile)
  } else if (value.kind === 'rest') {
    next = editHistoryDrafts(next, dates, { kind: 'rest' }, props.profile)
  } else {
    next = editHistoryDrafts(next, dates, { kind: 'work' }, props.profile)
    if (dates.length === 1 && value.isCleaningDay !== drafts.value.find((d) => d.date === dates[0])?.isCleaningDay) {
      next = editHistoryDrafts(next, dates, { isCleaningDay: value.isCleaningDay }, props.profile)
    }
    if (value.startTime && value.endTime) {
      next = editHistoryDrafts(next, dates, { startTime: value.startTime, endTime: value.endTime }, props.profile)
    }
    next = editHistoryDrafts(next, dates, { smokoMode: value.smokoMode, smokoCount: value.smokoCount }, props.profile)
  }
  drafts.value = next
  editorOpen.value = false
  selected.value = []
}

function toggleEditorCleaning(value) {
  editor.value.isCleaningDay = value
  const template = editorTemplate.value
  if (!template) return
  if (value && template.cleaningStartTime && template.cleaningEndTime) {
    editor.value.startTime = template.cleaningStartTime
    editor.value.endTime = template.cleaningEndTime
  } else if (!value) {
    editor.value.startTime = template.startTime
    editor.value.endTime = template.endTime
  }
}

// --- 保存 ---
async function confirmSave() {
  if (invalidCount.value) return showToast(`還有 ${invalidCount.value} 天的時間不完整，請先修正`)
  const { records, invalid } = historyDraftsToRecords(drafts.value, {
    records: props.records,
    buildWork: props.buildWork,
    nextId: props.nextId,
  })
  if (invalid) return showToast(`還有 ${invalid} 天無法計算，請檢查上下班時間`)
  if (!records.length) return showToast('沒有需要保存的紀錄')
  saving.value = true
  try {
    savedCount.value = await props.submit(records)
    step.value = 4
  } catch (error) {
    showToast(error?.message || '保存失敗，請稍後再試')
  } finally {
    saving.value = false
  }
}

function close() {
  emit('update:show', false)
}
</script>

<template>
  <van-popup
    :show="show"
    position="right"
    safe-area-inset-bottom
    class="history-wizard full-page-popup"
    :close-on-click-overlay="step === 0 || step === 4"
    @update:show="emit('update:show', $event)"
  >
    <div class="history-wizard__panel">
      <header class="history-wizard__header full-page__header">
        <div>
          <p class="history-wizard__eyebrow">補登歷史工作</p>
          <h2>{{ step < 4 ? STEPS[step] : '已保存' }}</h2>
        </div>
        <button type="button" class="history-wizard__close full-page__back" aria-label="返回" @click="close">
          <van-icon name="arrow-left" />
        </button>
      </header>
      <ol v-if="step < 4" class="history-steps" aria-label="步驟">
        <li v-for="(label, index) in STEPS" :key="label" :class="{ 'is-done': index < step, 'is-current': index === step }">
          <span>{{ index + 1 }}</span>{{ label }}
        </li>
      </ol>

      <!-- Step 1：期間 -->
      <section v-if="step === 0" class="history-wizard__content">
        <p class="history-note">依你的班別、每週排班與 Smoko 設定產生班表草稿。已經有紀錄的日期不會被覆蓋。</p>
        <van-cell-group inset>
          <van-field v-model="start" type="date" label="開始日期" :max="today" />
          <van-field v-model="end" type="date" label="結束日期" :max="today" />
        </van-cell-group>
        <p class="history-note">結束日期預設為今天；一次最多 {{ MAX_HISTORY_DAYS }} 天。</p>
      </section>

      <!-- Step 2／3：預覽與修正 -->
      <section v-else-if="step === 1 || step === 2" class="history-wizard__content">
        <div class="history-summary">
          <div><strong>{{ summary.work }}</strong><span>上班</span></div>
          <div><strong>{{ summary.leave }}</strong><span>請假</span></div>
          <div><strong>{{ summary.rest }}</strong><span>休息</span></div>
          <div><strong>{{ skippedExisting }}</strong><span>已有紀錄略過</span></div>
        </div>
        <p v-if="step === 1" class="history-note">
          共 {{ formatHours(totalHours) }}。這些只是草稿，下一步可以把請假、Holiday 或時間不同的日子改掉。
        </p>
        <p v-else class="history-note">勾選多天後一次修改，或點一天單獨調整上下班時間、Smoko 與狀態。</p>
        <p v-if="invalidCount" class="history-warning">{{ invalidCount }} 天的時間不完整，請修正。</p>
        <div v-if="step === 2" class="history-select-bar">
          <van-button size="small" plain type="primary" @click="selectAllWork">選取所有上班日</van-button>
          <van-button v-if="selected.length" size="small" plain @click="selected = []">清除選取</van-button>
        </div>

        <div v-for="group in groups" :key="group.month" class="history-group">
          <h3>{{ group.label }}</h3>
          <div
            v-for="draft in group.items"
            :key="draft.date"
            class="history-row"
            :class="[`is-${draft.kind}`, { 'is-selected': isSelected(draft.date) }]"
          >
            <van-checkbox
              v-if="step === 2"
              :model-value="isSelected(draft.date)"
              class="history-row__check"
              :aria-label="`選取 ${draft.date}`"
              @update:model-value="toggleSelect(draft.date)"
            />
            <button
              type="button"
              class="history-row__body"
              :disabled="step !== 2"
              @click="openEditor([draft.date])"
            >
              <strong>{{ dayLabel(draft.date) }}</strong>
              <span>{{ rowDetail(draft) }}</span>
            </button>
            <span class="history-row__tag">{{
              draft.kind === 'work' ? draft.shiftName : draft.kind === 'leave' ? '請假' : '休息'
            }}</span>
          </div>
        </div>
        <p v-if="!drafts.length" class="history-note">這段期間的日期都已經有紀錄，不需要補登。</p>
      </section>

      <!-- Step 4：確認 -->
      <section v-else-if="step === 3" class="history-wizard__content">
        <div class="history-summary">
          <div><strong>{{ summary.work }}</strong><span>上班</span></div>
          <div><strong>{{ summary.leave }}</strong><span>請假</span></div>
          <div><strong>{{ formatHours(totalHours).replace(' 小時', '') }}</strong><span>小時</span></div>
        </div>
        <ul class="history-confirm">
          <li>只會新增 {{ start }} 至 {{ end }} 之間還沒有紀錄的日期；休息日不保存。</li>
          <li>這些紀錄會標示為「使用者補登」，之後仍可在班表逐日修改。</li>
          <li>確認班表不代表雇主或 Home Affairs 已認定這些工作符合指定工作。</li>
          <li>不需要上傳過去所有薪資單；之後匯入的薪資單會自動拿來比對。</li>
        </ul>
      </section>

      <!-- 完成 -->
      <section v-else class="history-wizard__content history-done">
        <van-icon name="passed" class="history-done__icon" />
        <p>已保存 {{ savedCount }} 筆補登紀錄。</p>
        <van-button block type="primary" @click="emit('view-progress')">查看集簽進度</van-button>
      </section>

      <footer v-if="step < 4" class="history-wizard__footer">
        <template v-if="step === 2 && selected.length">
          <van-button class="history-wizard__secondary" plain @click="openEditor(selected)">修改時間</van-button>
          <van-button class="history-wizard__primary" type="primary" @click="actionsOpen = true">
            已選 {{ selected.length }} 天：設為…
          </van-button>
        </template>
        <template v-else>
          <van-button v-if="step > 0" class="history-wizard__secondary" plain @click="step -= 1">上一步</van-button>
          <van-button v-if="step === 0" class="history-wizard__primary" type="primary" @click="goPreview">產生班表草稿</van-button>
          <van-button v-else-if="step < 3" class="history-wizard__primary" type="primary" :disabled="!drafts.length" @click="step += 1">
            {{ step === 1 ? '下一步：修正請假' : '下一步：確認' }}
          </van-button>
          <van-button v-else class="history-wizard__primary" type="primary" :loading="saving" @click="confirmSave">
            確認保存
          </van-button>
        </template>
      </footer>
    </div>

    <van-action-sheet
      v-model:show="actionsOpen"
      :actions="bulkActions"
      cancel-text="取消"
      :description="`已選 ${selected.length} 天`"
      close-on-click-action
      @select="onBulkAction"
    />

    <van-popup v-model:show="editorOpen" position="bottom" round safe-area-inset-bottom class="history-editor">
      <div class="history-editor__body">
        <h3>{{ editorTitle }}</h3>
        <van-radio-group v-model="editor.kind" direction="horizontal" class="history-editor__kind">
          <van-radio name="work">上班</van-radio>
          <van-radio name="leave">請假</van-radio>
          <van-radio name="rest">休息日</van-radio>
        </van-radio-group>
        <template v-if="editor.kind === 'work'">
          <van-cell-group inset>
            <van-field v-model="editor.startTime" type="time" label="上班" />
            <van-field v-model="editor.endTime" type="time" label="下班" />
            <van-cell v-if="editorDates.length === 1 && editorTemplate?.cleaningStartTime" center title="清潔日">
              <template #right-icon>
                <van-switch :model-value="editor.isCleaningDay" size="22px" @update:model-value="toggleEditorCleaning" />
              </template>
            </van-cell>
            <van-cell center title="Smoko">
              <template #right-icon>
                <van-radio-group v-model="editor.smokoMode" direction="horizontal">
                  <van-radio name="AUTO">自動</van-radio>
                  <van-radio name="MANUAL">手動</van-radio>
                </van-radio-group>
              </template>
            </van-cell>
            <van-cell v-if="editor.smokoMode === 'MANUAL'" center title="Smoko 次數">
              <template #right-icon>
                <van-stepper v-model="editor.smokoCount" min="0" max="6" integer />
              </template>
            </van-cell>
          </van-cell-group>
          <p class="history-note">結束時間早於開始時間會視為跨午夜，記在上班當天。</p>
        </template>
        <template v-else-if="editor.kind === 'leave'">
          <van-radio-group v-model="editor.leaveType" class="history-editor__types">
            <van-radio v-for="type in LEAVE_TYPES" :key="type.id" :name="type.id">{{ type.label }}</van-radio>
          </van-radio-group>
          <p class="history-note">請假一律無薪，不產生工時，也不計入集簽工作天。</p>
        </template>
        <van-button block type="primary" class="history-wizard__primary" @click="applyEditor">套用</van-button>
      </div>
    </van-popup>
  </van-popup>
</template>

<style scoped>
.history-wizard__panel {
  display: flex;
  flex-direction: column;
  height: min(92dvh, 860px);
}
.history-wizard__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 18px var(--page-inset) 6px;
}
.history-wizard__eyebrow {
  margin: 0;
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
}
.history-wizard__header h2 {
  margin: 2px 0 0;
  font-size: var(--font-heading);
  color: var(--color-heading);
}
.history-wizard__close {
  width: var(--touch-target);
  height: var(--touch-target);
  border: 0;
  background: none;
  font-size: 20px;
  color: var(--color-muted);
}
.history-steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin: 0;
  padding: 0 var(--page-inset) 10px;
  list-style: none;
  font-size: 11px;
  color: var(--color-muted);
}
.history-steps li {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}
.history-steps span {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--color-border);
  font-weight: 700;
}
.history-steps .is-current {
  color: var(--color-primary);
  font-weight: 700;
}
.history-steps .is-current span,
.history-steps .is-done span {
  background: var(--color-primary);
  color: #fff;
}
.history-wizard__content {
  flex: 1;
  overflow-y: auto;
  padding: 4px var(--page-inset) 12px;
}
.history-note {
  margin: 8px 0;
  color: var(--color-muted);
  font-size: var(--font-caption);
  line-height: 1.5;
}
.history-warning {
  margin: 8px 0;
  color: var(--color-expense);
  font-size: var(--font-caption);
}
.history-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
  gap: 8px;
}
.history-summary div {
  display: grid;
  gap: 2px;
  padding: 10px 8px;
  border-radius: var(--radius-medium);
  background: var(--color-primary-soft);
  text-align: center;
}
.history-summary strong {
  font-size: 20px;
  color: var(--color-heading);
}
.history-summary span {
  font-size: 12px;
  color: var(--color-muted);
}
.history-select-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 8px;
}
.history-group h3 {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 12px 0 4px;
  padding: 4px 0;
  background: var(--color-surface);
  font-size: 14px;
  color: var(--color-heading);
}
.history-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 56px;
  border-bottom: 1px solid var(--color-border);
}
.history-row.is-selected {
  background: var(--color-primary-soft);
}
.history-row__check {
  flex: none;
  padding: 0 4px 0 2px;
}
.history-row__body {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
  padding: 8px 0;
  border: 0;
  background: none;
  text-align: left;
  font: inherit;
  color: var(--color-heading);
}
.history-row__body:disabled {
  color: var(--color-heading);
  opacity: 1;
}
.history-row__body strong {
  font-size: 14px;
}
.history-row__body span {
  overflow: hidden;
  color: var(--color-muted);
  font-size: 12px;
  text-overflow: ellipsis;
}
.history-row__tag {
  flex: none;
  max-width: 72px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--color-income-soft);
  color: var(--color-income);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history-row.is-leave .history-row__tag {
  background: var(--color-pending-soft);
  color: var(--color-pending);
}
.history-row.is-rest .history-row__tag {
  background: var(--color-border);
  color: var(--color-muted);
}
.history-confirm {
  margin: 14px 0;
  padding-left: 20px;
  color: var(--color-heading);
  font-size: 14px;
  line-height: 1.7;
}
.history-done {
  display: grid;
  justify-items: center;
  align-content: start;
  gap: 12px;
  padding-top: 32px;
  text-align: center;
}
.history-done__icon {
  font-size: 48px;
  color: var(--color-income);
}
.history-wizard__footer {
  display: flex;
  gap: 10px;
  padding: 10px var(--page-inset) calc(12px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.history-wizard__primary {
  flex: 2;
  height: var(--page-button-height);
}
.history-wizard__secondary {
  flex: 1;
  height: var(--page-button-height);
}
.history-editor__body {
  max-height: 80dvh;
  overflow-y: auto;
  padding: 20px var(--page-inset) calc(16px + env(safe-area-inset-bottom, 0px));
}
.history-editor__body h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.history-editor__kind {
  margin-bottom: 12px;
}
.history-editor__types {
  display: grid;
  gap: 14px;
  margin: 8px 4px 12px;
}
.history-editor .history-wizard__primary {
  width: 100%;
  margin-top: 12px;
}
</style>

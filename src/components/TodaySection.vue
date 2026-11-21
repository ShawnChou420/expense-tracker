<script setup>
// 首頁「今天」：今日待辦、給今天的你一句話、心情與備註。
// 會員資料存在資料庫（一次 /api/today 取回）；小語載入失敗不影響其他卡片。
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDateLabel } from '../i18n/format.js'
import { showConfirmDialog, showToast } from 'vant'
import { todayRepository } from '../repositories/todayRepository.js'
import { authToken } from '../services/authSession.js'
import {
  MOODS,
  REPEAT_OPTIONS,
  addDays,
  getTaskProgress,
} from '../domain/today.js'

const { t } = useI18n()
const props = defineProps({
  // 裝置本地的今天 YYYY-MM-DD（跨日時父元件會更新）
  today: { type: String, required: true },
  // 首頁自訂：三個區塊各自顯示與順序（CSS order）。資料仍然只用一次 /api/today 載入
  parts: {
    type: Object,
    default: () => ({
      tasks: { visible: true, order: 0 },
      quote: { visible: true, order: 1 },
      mood: { visible: true, order: 2 },
    }),
  },
})
const partStyle = (/** @type {'tasks' | 'quote' | 'mood'} */ part) => ({ order: props.parts[part]?.order ?? 0 })

const loading = ref(true)
const loadError = ref('')
const tasks = ref([])
const overdue = ref([])
const quote = ref(null)
const quoteFailed = ref(false)
const refreshing = ref(false)

const progress = computed(() => getTaskProgress(tasks.value))
const isMember = computed(() => Boolean(authToken.value))

// 每次載入的序號：登入狀態或日期在載入途中改變時，只採用最後一次的結果（避免舊請求的錯誤蓋掉新結果）
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  loading.value = true
  loadError.value = ''
  try {
    const data = await todayRepository.load(props.today)
    if (seq !== loadSeq) return
    tasks.value = data.tasks || []
    overdue.value = data.overdue || []
    quote.value = data.quote
    quoteFailed.value = !data.quote
    applyJournal(data.journal)
  } catch (error) {
    if (seq !== loadSeq) return
    loadError.value = error.message || t('today.loadFailedShort')
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function reloadTasks() {
  const [list, pending] = await Promise.all([
    todayRepository.tasksFor(props.today),
    todayRepository.overdueFor(props.today),
  ])
  tasks.value = list
  overdue.value = pending
}

// --- 待辦 ---
const quickTitle = ref('')
const adding = ref(false)

async function quickAdd() {
  const title = quickTitle.value.trim()
  if (!title || adding.value) return
  adding.value = true
  try {
    const task = await todayRepository.createTask({ title, taskDate: props.today, repeatType: 'NONE' })
    tasks.value = [...tasks.value, task]
    quickTitle.value = ''
  } catch (error) {
    showToast(error.message)
  } finally {
    adding.value = false
  }
}

async function toggle(task) {
  const completed = !task.completed
  task.completed = completed // 先更新畫面，失敗再還原
  try {
    await todayRepository.updateTask(task.id, {
      completed,
      occurrenceDate: task.occurrenceDate || props.today,
    })
  } catch (error) {
    task.completed = !completed
    showToast(error.message)
  }
}

const editor = ref({ show: false, id: null, title: '', description: '', taskDate: '', repeatType: 'NONE', saving: false })

function openEditor(task = null) {
  editor.value = {
    show: true,
    id: task?.id ?? null,
    title: task?.title ?? '',
    description: task?.description ?? '',
    taskDate: task?.taskDate ?? props.today,
    repeatType: task?.repeatType ?? 'NONE',
    saving: false,
  }
}

async function saveEditor() {
  const form = editor.value
  if (!form.title.trim()) {
    showToast(t('today.enterTask'))
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.taskDate)) {
    showToast(t('today.chooseDate'))
    return
  }
  form.saving = true
  const body = {
    title: form.title.trim(),
    description: form.description.trim(),
    taskDate: form.taskDate,
    repeatType: form.repeatType,
  }
  try {
    if (form.id === null) await todayRepository.createTask(body)
    else await todayRepository.updateTask(form.id, body)
    form.show = false
    await reloadTasks()
    showToast(form.id === null ? t('today.added') : t('common.saved'))
  } catch (error) {
    showToast(error.message)
  } finally {
    form.saving = false
  }
}

async function removeTask(task) {
  try {
    await showConfirmDialog({
      title: t('today.deleteTaskTitle'),
      message:
        task.repeatType && task.repeatType !== 'NONE'
          ? t('today.deleteRepeatMessage', { title: task.title })
          : t('today.deleteTaskMessage', { title: task.title }),
    })
  } catch {
    return
  }
  try {
    await todayRepository.removeTask(task.id)
    editor.value.show = false
    await reloadTasks()
  } catch (error) {
    showToast(error.message)
  }
}

// 之前沒完成的事：使用者自己決定，不自動改日期或刪除
const showOverdue = ref(false)

async function completeOverdue(task) {
  try {
    await todayRepository.updateTask(task.id, { completed: true })
    overdue.value = overdue.value.filter((item) => item.id !== task.id)
  } catch (error) {
    showToast(error.message)
  }
}

async function postponeOverdue(task) {
  try {
    await todayRepository.updateTask(task.id, { taskDate: props.today })
    await reloadTasks()
    showToast(t('today.movedToToday'))
  } catch (error) {
    showToast(error.message)
  }
}

function keepOverdue(task) {
  // 保留原日期：只是這次先不處理，資料不變
  overdue.value = overdue.value.filter((item) => item.id !== task.id)
  if (overdue.value.length === 0) showOverdue.value = false
}

// --- 每日小語 ---
async function refreshQuote() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    quote.value = await todayRepository.refreshQuote(props.today)
    quoteFailed.value = false
  } catch (error) {
    showToast(error.message)
  } finally {
    refreshing.value = false
  }
}

async function retryQuote() {
  await load()
}

// --- 心情與備註 ---
const journalDate = ref(props.today)
const journalText = ref('')
const savedText = ref('')
const mood = ref(null)
const journalState = ref('idle') // idle | saving | saved | failed
const savedAt = ref('')
const journalLoading = ref(false)
const dirty = computed(() => journalText.value !== savedText.value)
const isJournalToday = computed(() => journalDate.value === props.today)

function applyJournal(journal) {
  journalText.value = journal?.content ?? ''
  savedText.value = journalText.value
  mood.value = journal?.mood ?? null
  journalState.value = journal?.saved ? 'saved' : 'idle'
  savedAt.value = journal?.updatedAt ? formatTime(journal.updatedAt) : ''
}

function formatTime(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

async function moveJournal(days) {
  if (dirty.value) {
    try {
      await showConfirmDialog({ title: t('today.unsavedTitle'), message: t('today.unsavedSwitchDate') })
    } catch {
      return
    }
  }
  const next = addDays(journalDate.value, days)
  if (next > props.today) return
  journalLoading.value = true
  try {
    applyJournal(await todayRepository.journalFor(next))
    journalDate.value = next
  } catch (error) {
    showToast(error.message)
  } finally {
    journalLoading.value = false
  }
}

async function chooseMood(value) {
  const previous = mood.value
  const next = previous === value ? null : value // 再點一次取消
  mood.value = next
  try {
    const saved = await todayRepository.saveJournal(journalDate.value, { mood: next })
    savedAt.value = saved?.updatedAt ? formatTime(saved.updatedAt) : savedAt.value
  } catch (error) {
    mood.value = previous
    showToast(error.message)
  }
}

async function saveJournal() {
  if (journalState.value === 'saving') return
  journalState.value = 'saving'
  const content = journalText.value
  try {
    const saved = await todayRepository.saveJournal(journalDate.value, { content })
    savedText.value = content
    savedAt.value = saved?.updatedAt ? formatTime(saved.updatedAt) : ''
    journalState.value = 'saved'
    showToast(t('today.noteSaved'))
  } catch (error) {
    // 內容保留在輸入框，不會消失
    journalState.value = 'failed'
    showToast(error.message || t('today.saveFailed'))
  }
}

const journalStatus = computed(() => {
  if (journalState.value === 'saving') return t('common.saving')
  if (journalState.value === 'failed') return t('today.saveFailedRetry')
  if (dirty.value) return t('common.unsaved')
  if (journalState.value === 'saved') return savedAt.value ? t('today.savedAt', { time: savedAt.value }) : t('common.saved')
  return isMember.value ? t('today.privateNote') : t('today.guestTemporary')
})

watch(
  () => [props.today, authToken.value],
  () => {
    journalDate.value = props.today
    load()
  },
  { immediate: true },
)

defineExpose({ reload: load })
</script>

<template>
  <div class="today-section">
    <!-- 今日待辦 -->
    <section
      v-if="parts.tasks?.visible"
      class="today-card app-page__card"
      :style="partStyle('tasks')"
      aria-labelledby="today-tasks-title"
    >
      <div class="today-card__head">
        <h2 id="today-tasks-title">{{ t('today.tasks') }}</h2>
        <span v-if="!loading && progress.total > 0" class="today-card__count">
          {{ t('today.doneOfTotal', { done: progress.done, total: progress.total }) }}
        </span>
        <button type="button" class="today-card__icon-button" :aria-label="t('today.addTaskAria')" @click="openEditor()">
          <van-icon name="plus" />
        </button>
      </div>

      <van-skeleton v-if="loading" :row="3" />
      <div v-else-if="loadError" class="today-card__error" role="alert">
        <p>{{ t('today.loadFailed', { error: loadError }) }}</p>
        <van-button size="small" type="primary" plain @click="load">{{ t('common.retry') }}</van-button>
      </div>
      <template v-else>
        <button
          v-if="overdue.length > 0"
          type="button"
          class="today-overdue"
          @click="showOverdue = true"
        >
          <van-icon name="info-o" aria-hidden="true" />
          <span>{{ t('today.overdueCount', { count: overdue.length }) }}</span>
          <van-icon name="arrow" aria-hidden="true" />
        </button>

        <ul v-if="tasks.length > 0" class="today-tasks">
          <li v-for="task in tasks" :key="`${task.id}-${task.occurrenceDate}`" class="today-task">
            <button
              type="button"
              role="checkbox"
              class="today-task__check"
              :class="{ 'today-task__check--done': task.completed }"
              :aria-checked="task.completed"
              :aria-label="t(task.completed ? 'today.untoggleTask' : 'today.toggleTask', { title: task.title })"
              @click="toggle(task)"
            >
              <van-icon v-if="task.completed" name="success" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="today-task__title"
              :class="{ 'today-task__title--done': task.completed }"
              @click="openEditor(task)"
            >
              {{ task.title }}
              <small v-if="task.repeatType && task.repeatType !== 'NONE'">
                {{ t(`today.repeats.${task.repeatType}`) }}
              </small>
            </button>
          </li>
        </ul>
        <p v-else class="today-card__empty">{{ t('today.noTasks') }}</p>

        <form class="today-quick-add" @submit.prevent="quickAdd">
          <input
            v-model="quickTitle"
            type="text"
            maxlength="80"
            enterkeyhint="done"
            :placeholder="t('today.addTaskPlaceholder')"
            :aria-label="t('today.quickAddAria')"
          />
          <van-button
            native-type="submit"
            size="small"
            type="primary"
            :loading="adding"
            :disabled="!quickTitle.trim()"
          >
            {{ t('common.add') }}
          </van-button>
        </form>
      </template>
    </section>

    <!-- 給今天的你，一句話 -->
    <section
      v-if="parts.quote?.visible"
      class="today-quote app-page__card"
      :style="partStyle('quote')"
      aria-labelledby="today-quote-title"
    >
      <div class="today-card__head">
        <h2 id="today-quote-title">{{ t('today.quote') }}</h2>
        <button
          v-if="isMember && quote && quote.refreshesLeft > 0"
          type="button"
          class="today-quote__refresh"
          :disabled="refreshing"
          @click="refreshQuote"
        >
          <van-icon name="replay" aria-hidden="true" />{{ t('today.anotherQuote') }}
        </button>
      </div>
      <van-skeleton v-if="loading" :row="2" />
      <blockquote v-else-if="quote" class="today-quote__text">
        {{ quote.content }}
        <footer v-if="quote.source || quote.author">—— {{ quote.source || quote.author }}</footer>
      </blockquote>
      <div v-else-if="quoteFailed" class="today-card__error">
        <p>{{ t('today.quoteUnavailable') }}</p>
        <van-button size="small" plain type="primary" @click="retryQuote">{{ t('common.retry') }}</van-button>
      </div>
    </section>

    <!-- 心情與備註 -->
    <section
      v-if="parts.mood?.visible"
      class="today-card app-page__card"
      :style="partStyle('mood')"
      aria-labelledby="today-mood-title"
    >
      <div class="today-card__head">
        <h2 id="today-mood-title">{{ isJournalToday ? t('today.moodQuestion') : t('today.dayRecord', { date: formatDateLabel(journalDate) }) }}</h2>
        <div class="today-date-nav">
          <button type="button" :aria-label="t('today.previousDay')" @click="moveJournal(-1)">
            <van-icon name="arrow-left" />
          </button>
          <button
            type="button"
            :aria-label="t('today.nextDay')"
            :disabled="isJournalToday"
            @click="moveJournal(1)"
          >
            <van-icon name="arrow" />
          </button>
        </div>
      </div>
      <van-skeleton v-if="loading || journalLoading" :row="3" />
      <template v-else-if="!loadError">
        <div class="today-moods" role="group" :aria-label="t('today.mood')">
          <button
            v-for="option in MOODS"
            :key="option.value"
            type="button"
            class="today-mood"
            :class="{ 'today-mood--active': mood === option.value }"
            :aria-pressed="mood === option.value"
            @click="chooseMood(option.value)"
          >
            <span aria-hidden="true">{{ option.emoji }}</span>
            <small>{{ t(`today.moods.${option.value}`) }}</small>
          </button>
        </div>
        <label class="today-journal">
          <span class="today-journal__label">{{ isJournalToday ? t('today.todayNote') : t('common.note') }}</span>
          <textarea
            v-model="journalText"
            rows="3"
            maxlength="2000"
            :placeholder="t('today.journalTodayPlaceholder')"
          ></textarea>
        </label>
        <div class="today-journal__foot">
          <small
            :class="{ 'today-journal__status--failed': journalState === 'failed' }"
            aria-live="polite"
          >
            {{ journalStatus }}
          </small>
          <van-button
            size="small"
            type="primary"
            :plain="!dirty"
            :loading="journalState === 'saving'"
            :disabled="!dirty && journalState !== 'failed'"
            @click="saveJournal"
          >
            {{ t('common.save') }}
          </van-button>
        </div>
      </template>
    </section>

    <!-- 新增／編輯待辦 -->
    <van-popup
      v-model:show="editor.show"
      position="bottom"
      round
      teleport="body"
      safe-area-inset-bottom
      class="today-popup"
    >
      <form class="today-editor" @submit.prevent="saveEditor">
        <h3>{{ editor.id === null ? t('today.newTask') : t('today.editTask') }}</h3>
        <van-field
          v-model="editor.title"
          :label="t('today.taskContent')"
          maxlength="80"
          :placeholder="t('today.taskPlaceholder')"
          required
        />
        <van-field
          v-model="editor.description"
          :label="t('common.note')"
          type="textarea"
          rows="2"
          autosize
          maxlength="500"
          :placeholder="t('common.optional')"
        />
        <label class="today-editor__row">
          <span>{{ t('common.date') }}</span>
          <input v-model="editor.taskDate" type="date" required />
        </label>
        <div class="today-editor__row">
          <span>{{ t('today.repeat') }}</span>
          <div class="today-editor__chips" role="radiogroup" :aria-label="t('today.repeat')">
            <button
              v-for="option in REPEAT_OPTIONS"
              :key="option.value"
              type="button"
              role="radio"
              :aria-checked="editor.repeatType === option.value"
              :class="{ active: editor.repeatType === option.value }"
              @click="editor.repeatType = option.value"
            >
              {{ t(`today.repeats.${option.value}`) }}
            </button>
          </div>
        </div>
        <p v-if="editor.repeatType !== 'NONE'" class="today-editor__hint">
          {{ t('today.repeatHint') }}
        </p>
        <div class="today-editor__actions">
          <van-button
            v-if="editor.id !== null"
            type="danger"
            plain
            @click="removeTask({ id: editor.id, title: editor.title, repeatType: editor.repeatType })"
          >
            {{ t('common.delete') }}
          </van-button>
          <van-button native-type="submit" type="primary" block :loading="editor.saving">{{ t('common.save') }}</van-button>
        </div>
      </form>
    </van-popup>

    <!-- 之前未完成的事項 -->
    <van-popup
      v-model:show="showOverdue"
      position="bottom"
      round
      teleport="body"
      safe-area-inset-bottom
      closeable
      class="today-popup"
    >
      <div class="today-editor">
        <h3>{{ t('today.overdueTitle') }}</h3>
        <p class="today-editor__hint">{{ t('today.overdueHint') }}</p>
        <ul class="today-overdue-list">
          <li v-for="task in overdue" :key="task.id">
            <div>
              <strong>{{ task.title }}</strong>
              <small>{{ t('today.originalDate', { date: formatDateLabel(task.taskDate) }) }}</small>
            </div>
            <div class="today-overdue-list__actions">
              <van-button size="small" type="primary" @click="completeOverdue(task)">{{ t('common.done') }}</van-button>
              <van-button size="small" plain type="primary" @click="postponeOverdue(task)">{{ t('today.moveToToday') }}</van-button>
              <van-button size="small" plain @click="keepOverdue(task)">{{ t('today.keepDate') }}</van-button>
              <van-button size="small" plain type="danger" @click="removeTask(task)">{{ t('common.delete') }}</van-button>
            </div>
          </li>
        </ul>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.today-section {
  /* 三個區塊直接成為首頁模組容器的項目，才能和其他模組一起排序 */
  display: contents;
}
.today-card,
.today-quote {
  display: grid;
  gap: 12px;
  padding: 16px;
}
.today-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}
.today-card__head h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--color-heading);
  font-size: 16px;
  font-weight: 800;
}
.today-card__count {
  color: var(--color-muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.today-card__icon-button,
.today-date-nav button {
  display: grid;
  place-items: center;
  width: var(--touch-target);
  height: var(--touch-target);
  margin: -6px -8px -6px 0;
  border: 0;
  border-radius: 12px;
  background: none;
  color: var(--color-primary);
  font-size: 18px;
  cursor: pointer;
}
.today-date-nav {
  display: flex;
  margin-right: -8px;
}
.today-date-nav button {
  margin: -6px 0;
}
.today-date-nav button:disabled {
  color: #c3ccd7;
  cursor: default;
}
.today-card__empty {
  margin: 0;
  color: var(--color-muted);
  font-size: 14px;
}
.today-card__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.today-card__error p {
  margin: 0;
  color: var(--color-muted);
  font-size: 14px;
}
.today-overdue {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--touch-target);
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  background: var(--color-pending-soft);
  color: var(--color-pending);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.today-overdue span {
  flex: 1;
}
.today-tasks {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.today-task {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--touch-target);
  border-bottom: 1px solid var(--color-border);
}
.today-task:last-child {
  border-bottom: 0;
}
.today-task__check {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--touch-target);
  height: var(--touch-target);
  margin-left: -11px;
  padding: 0;
  border: 0;
  background: none;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.today-task__check::before {
  content: '';
  grid-area: 1 / 1;
  width: 22px;
  height: 22px;
  border: 2px solid #c3ccd7;
  border-radius: 50%;
  box-sizing: border-box;
}
.today-task__check .van-icon {
  grid-area: 1 / 1;
  z-index: 1;
}
.today-task__check--done::before {
  border-color: var(--color-income);
  background: var(--color-income);
}
.today-task__title {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: var(--touch-target);
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-heading);
  font: inherit;
  font-size: 15px;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.today-task__title--done {
  color: #94a3b4;
  text-decoration: line-through;
}
.today-task__title small {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: var(--font-caption);
  text-decoration: none;
}
.today-quick-add {
  display: flex;
  gap: 8px;
}
.today-quick-add input {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background);
  color: var(--color-heading);
  font: inherit;
  font-size: 16px; /* iOS 不會自動放大 */
}
.today-quick-add .van-button {
  height: 40px;
  padding: 0 16px;
}
.today-quote {
  background: var(--color-primary-soft);
  box-shadow: none;
}
.today-quote__refresh {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.today-quote__refresh:disabled {
  opacity: 0.6;
}
.today-quote__text {
  margin: 0;
  color: var(--color-heading);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.65;
}
.today-quote__text footer {
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 400;
}
.today-moods {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}
.today-mood {
  display: grid;
  justify-items: center;
  gap: 2px;
  min-height: 60px;
  padding: 6px 0;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  color: var(--color-muted);
  font: inherit;
  cursor: pointer;
}
.today-mood span {
  font-size: 24px;
  line-height: 1.2;
}
.today-mood small {
  font-size: var(--font-caption);
  white-space: nowrap;
}
.today-mood--active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 700;
}
.today-journal {
  display: grid;
  gap: 6px;
}
.today-journal__label {
  color: var(--color-muted);
  font-size: 13px;
}
.today-journal textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 84px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background);
  color: var(--color-heading);
  font: inherit;
  font-size: 16px;
  line-height: 1.5;
  resize: vertical;
}
.today-journal__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.today-journal__foot small {
  color: var(--color-muted);
  font-size: var(--font-caption);
}
.today-journal__status--failed {
  color: var(--color-expense) !important;
  font-weight: 700;
}
.today-editor {
  display: grid;
  gap: 12px;
  padding: 20px 16px 16px;
}
.today-editor h3 {
  margin: 0;
  color: var(--color-heading);
  font-size: 18px;
}
.today-editor__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  color: var(--color-heading);
  font-size: 14px;
}
.today-editor__row > span {
  flex: none;
  width: 72px;
}
.today-editor__row input {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background);
  font: inherit;
  font-size: 16px;
}
.today-editor__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.today-editor__chips button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.today-editor__chips button.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 700;
}
.today-editor__hint {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
}
.today-editor__actions {
  display: flex;
  gap: 10px;
}
.today-editor__actions .van-button--danger {
  flex: none;
  width: 96px;
}
.today-overdue-list {
  display: grid;
  gap: 12px;
  max-height: 60dvh;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.today-overdue-list li {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
}
.today-overdue-list strong {
  display: block;
  color: var(--color-heading);
}
.today-overdue-list small {
  color: var(--color-muted);
}
.today-overdue-list__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>

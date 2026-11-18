<script setup>
// 首頁「今天」：今日待辦、給今天的你一句話、心情與備註。
// 會員資料存在資料庫（一次 /api/today 取回）；小語載入失敗不影響其他卡片。
import { computed, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { todayRepository } from '../repositories/todayRepository.js'
import { authToken } from '../services/authSession.js'
import {
  MOODS,
  REPEAT_OPTIONS,
  addDays,
  formatDateLabel,
  getTaskProgress,
} from '../domain/today.js'

const props = defineProps({
  // 裝置本地的今天 YYYY-MM-DD（跨日時父元件會更新）
  today: { type: String, required: true },
})

const loading = ref(true)
const loadError = ref('')
const tasks = ref([])
const overdue = ref([])
const quote = ref(null)
const quoteFailed = ref(false)
const refreshing = ref(false)

const progress = computed(() => getTaskProgress(tasks.value))
const isMember = computed(() => Boolean(authToken.value))

async function load() {
  loading.value = true
  loadError.value = ''
  const identity = authToken.value
  try {
    const data = await todayRepository.load(props.today)
    if (identity !== authToken.value) return
    tasks.value = data.tasks || []
    overdue.value = data.overdue || []
    quote.value = data.quote
    quoteFailed.value = !data.quote
    applyJournal(data.journal)
  } catch (error) {
    loadError.value = error.message || '暫時無法載入'
  } finally {
    loading.value = false
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
    showToast('請輸入待辦內容')
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.taskDate)) {
    showToast('請選擇日期')
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
    showToast(form.id === null ? '已新增' : '已儲存')
  } catch (error) {
    showToast(error.message)
  } finally {
    form.saving = false
  }
}

async function removeTask(task) {
  try {
    await showConfirmDialog({
      title: '刪除這個待辦？',
      message:
        task.repeatType && task.repeatType !== 'NONE'
          ? `「${task.title}」是重複待辦，刪除後之後每一次都不會再出現。`
          : `「${task.title}」將被刪除。`,
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
    showToast('已移到今天')
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
      await showConfirmDialog({ title: '還沒儲存', message: '切換日期會放棄這次還沒儲存的備註，確定嗎？' })
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
    showToast('備註已儲存')
  } catch (error) {
    // 內容保留在輸入框，不會消失
    journalState.value = 'failed'
    showToast(error.message || '儲存失敗')
  }
}

const journalStatus = computed(() => {
  if (journalState.value === 'saving') return '儲存中…'
  if (journalState.value === 'failed') return '儲存失敗，內容還在，請再按一次儲存'
  if (dirty.value) return '尚未儲存'
  if (journalState.value === 'saved') return savedAt.value ? `已儲存 ${savedAt.value}` : '已儲存'
  return isMember.value ? '只有你看得到' : '訪客模式：重新整理後會消失'
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
    <section class="today-card app-page__card" aria-labelledby="today-tasks-title">
      <div class="today-card__head">
        <h2 id="today-tasks-title">今日待辦</h2>
        <span v-if="!loading && progress.total > 0" class="today-card__count">
          {{ progress.done }} / {{ progress.total }} 已完成
        </span>
        <button type="button" class="today-card__icon-button" aria-label="新增待辦（可選日期與重複）" @click="openEditor()">
          <van-icon name="plus" />
        </button>
      </div>

      <van-skeleton v-if="loading" :row="3" />
      <div v-else-if="loadError" class="today-card__error" role="alert">
        <p>今天的資料暫時載入不了：{{ loadError }}</p>
        <van-button size="small" type="primary" plain @click="load">重試</van-button>
      </div>
      <template v-else>
        <button
          v-if="overdue.length > 0"
          type="button"
          class="today-overdue"
          @click="showOverdue = true"
        >
          <van-icon name="info-o" aria-hidden="true" />
          <span>還有 {{ overdue.length }} 件之前未完成的事項</span>
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
              :aria-label="`${task.completed ? '取消完成' : '完成'}：${task.title}`"
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
                {{ REPEAT_OPTIONS.find((option) => option.value === task.repeatType)?.label }}
              </small>
            </button>
          </li>
        </ul>
        <p v-else class="today-card__empty">今天還沒有待辦，想到什麼就記一下。</p>

        <form class="today-quick-add" @submit.prevent="quickAdd">
          <input
            v-model="quickTitle"
            type="text"
            maxlength="80"
            enterkeyhint="done"
            placeholder="新增一件小事，例如：買菜"
            aria-label="快速新增今日待辦"
          />
          <van-button
            native-type="submit"
            size="small"
            type="primary"
            :loading="adding"
            :disabled="!quickTitle.trim()"
          >
            新增
          </van-button>
        </form>
      </template>
    </section>

    <!-- 給今天的你，一句話 -->
    <section class="today-quote app-page__card" aria-labelledby="today-quote-title">
      <div class="today-card__head">
        <h2 id="today-quote-title">給今天的你，一句話</h2>
        <button
          v-if="isMember && quote && quote.refreshesLeft > 0"
          type="button"
          class="today-quote__refresh"
          :disabled="refreshing"
          @click="refreshQuote"
        >
          <van-icon name="replay" aria-hidden="true" />換一句
        </button>
      </div>
      <van-skeleton v-if="loading" :row="2" />
      <blockquote v-else-if="quote" class="today-quote__text">
        {{ quote.content }}
        <footer v-if="quote.source || quote.author">—— {{ quote.source || quote.author }}</footer>
      </blockquote>
      <div v-else-if="quoteFailed" class="today-card__error">
        <p>今天的小語暫時載入不了。</p>
        <van-button size="small" plain type="primary" @click="retryQuote">重試</van-button>
      </div>
    </section>

    <!-- 心情與備註 -->
    <section class="today-card app-page__card" aria-labelledby="today-mood-title">
      <div class="today-card__head">
        <h2 id="today-mood-title">{{ isJournalToday ? '今天感覺如何？' : `${formatDateLabel(journalDate)} 的紀錄` }}</h2>
        <div class="today-date-nav">
          <button type="button" aria-label="前一天" @click="moveJournal(-1)">
            <van-icon name="arrow-left" />
          </button>
          <button
            type="button"
            aria-label="後一天"
            :disabled="isJournalToday"
            @click="moveJournal(1)"
          >
            <van-icon name="arrow" />
          </button>
        </div>
      </div>
      <van-skeleton v-if="loading || journalLoading" :row="3" />
      <template v-else-if="!loadError">
        <div class="today-moods" role="group" aria-label="心情">
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
            <small>{{ option.label }}</small>
          </button>
        </div>
        <label class="today-journal">
          <span class="today-journal__label">{{ isJournalToday ? '今天的備註' : '備註' }}</span>
          <textarea
            v-model="journalText"
            rows="3"
            maxlength="2000"
            placeholder="記一下今天發生的事，例如：下午去 Woolworths 買菜。"
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
            儲存
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
        <h3>{{ editor.id === null ? '新增待辦' : '編輯待辦' }}</h3>
        <van-field
          v-model="editor.title"
          label="內容"
          maxlength="80"
          placeholder="例如：上班前磨刀"
          required
        />
        <van-field
          v-model="editor.description"
          label="備註"
          type="textarea"
          rows="2"
          autosize
          maxlength="500"
          placeholder="選填"
        />
        <label class="today-editor__row">
          <span>日期</span>
          <input v-model="editor.taskDate" type="date" required />
        </label>
        <div class="today-editor__row">
          <span>重複</span>
          <div class="today-editor__chips" role="radiogroup" aria-label="重複">
            <button
              v-for="option in REPEAT_OPTIONS"
              :key="option.value"
              type="button"
              role="radio"
              :aria-checked="editor.repeatType === option.value"
              :class="{ active: editor.repeatType === option.value }"
              @click="editor.repeatType = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <p v-if="editor.repeatType !== 'NONE'" class="today-editor__hint">
          重複待辦每一次分開勾選，今天完成不會影響之後。
        </p>
        <div class="today-editor__actions">
          <van-button
            v-if="editor.id !== null"
            type="danger"
            plain
            @click="removeTask({ id: editor.id, title: editor.title, repeatType: editor.repeatType })"
          >
            刪除
          </van-button>
          <van-button native-type="submit" type="primary" block :loading="editor.saving">儲存</van-button>
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
        <h3>之前未完成的事項</h3>
        <p class="today-editor__hint">不會自動刪除或改日期，由你決定怎麼處理。</p>
        <ul class="today-overdue-list">
          <li v-for="task in overdue" :key="task.id">
            <div>
              <strong>{{ task.title }}</strong>
              <small>原訂 {{ formatDateLabel(task.taskDate) }}</small>
            </div>
            <div class="today-overdue-list__actions">
              <van-button size="small" type="primary" @click="completeOverdue(task)">完成</van-button>
              <van-button size="small" plain type="primary" @click="postponeOverdue(task)">移到今天</van-button>
              <van-button size="small" plain @click="keepOverdue(task)">保留原日期</van-button>
              <van-button size="small" plain type="danger" @click="removeTask(task)">刪除</van-button>
            </div>
          </li>
        </ul>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.today-section {
  display: grid;
  gap: 14px;
  margin-top: 14px;
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
  font-size: 11px;
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
  font-size: 12px;
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
  font-size: 12px;
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

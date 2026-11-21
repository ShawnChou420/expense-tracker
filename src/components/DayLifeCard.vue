<script setup>
// 班表日曆的日期明細：當天心情、日記（備註）、待辦與每日小語。
// 與首頁「今天」用同一個 todayRepository，所以在這裡修改，首頁同一天也會看到。
// 日記內容要按「儲存」；父元件用 dirty／save／reset 接上當天面板的未儲存提醒。
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { showToast } from 'vant'
import { todayRepository } from '../repositories/todayRepository.js'
import { MOODS, REPEAT_OPTIONS } from '../domain/today.js'

const { t } = useI18n()
const props = defineProps({
  // 本地日期 YYYY-MM-DD
  date: { type: String, required: true },
})

const loading = ref(true)
const loadError = ref('')
const tasks = ref([])
const quote = ref(null)
const mood = ref(null)
const journalText = ref('')
const savedText = ref('')
const savingJournal = ref(false)
const dirty = computed(() => journalText.value !== savedText.value)
const doneCount = computed(() => tasks.value.filter((task) => task.completed).length)
const quickTitle = ref('')
const adding = ref(false)

let loadSeq = 0
async function load() {
  const seq = ++loadSeq
  loading.value = true
  loadError.value = ''
  try {
    const data = await todayRepository.load(props.date)
    if (seq !== loadSeq) return
    tasks.value = data.tasks || []
    quote.value = data.quote || null
    mood.value = data.journal?.mood ?? null
    journalText.value = data.journal?.content ?? ''
    savedText.value = journalText.value
  } catch (error) {
    if (seq !== loadSeq) return
    loadError.value = error.message || t('today.loadFailedShort')
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}
watch(() => props.date, load, { immediate: true })

async function chooseMood(value) {
  const previous = mood.value
  const next = previous === value ? null : value
  mood.value = next // 先更新畫面，失敗再還原
  try {
    await todayRepository.saveJournal(props.date, { mood: next })
  } catch (error) {
    mood.value = previous
    showToast(error.message)
  }
}

/** @returns {Promise<boolean>} 是否儲存成功 */
async function save() {
  if (!dirty.value) return true
  savingJournal.value = true
  const content = journalText.value
  try {
    await todayRepository.saveJournal(props.date, { content })
    savedText.value = content
    return true
  } catch (error) {
    showToast(error.message)
    return false
  } finally {
    savingJournal.value = false
  }
}

function reset() {
  journalText.value = savedText.value
}

async function toggle(task) {
  const completed = !task.completed
  task.completed = completed
  try {
    await todayRepository.updateTask(task.id, {
      completed,
      occurrenceDate: task.occurrenceDate || props.date,
    })
  } catch (error) {
    task.completed = !completed
    showToast(error.message)
  }
}

async function quickAdd() {
  const title = quickTitle.value.trim()
  if (!title || adding.value) return
  adding.value = true
  try {
    const task = await todayRepository.createTask({
      title,
      taskDate: props.date,
      repeatType: 'NONE',
    })
    tasks.value = [...tasks.value, task]
    quickTitle.value = ''
  } catch (error) {
    showToast(error.message)
  } finally {
    adding.value = false
  }
}

defineExpose({ dirty, save, reset })
</script>

<template>
  <section class="day-life" aria-labelledby="day-life-title">
    <h2 id="day-life-title">{{ t('calendar.dailyLife') }}</h2>
    <van-skeleton v-if="loading" :row="3" />
    <p v-else-if="loadError" class="day-life__error" role="alert">
      {{ t('dayLife.loadFailed', { error: loadError }) }}
      <van-button size="mini" plain type="primary" @click="load">{{ t('common.retry') }}</van-button>
    </p>
    <template v-else>
      <div class="day-life__moods" role="group" :aria-label="t('today.mood')">
        <button
          v-for="option in MOODS"
          :key="option.value"
          type="button"
          class="day-life__mood"
          :class="{ 'is-active': mood === option.value }"
          :aria-pressed="mood === option.value"
          @click="chooseMood(option.value)"
        >
          <span aria-hidden="true">{{ option.emoji }}</span>
          <small>{{ t(`today.moods.${option.value}`) }}</small>
        </button>
      </div>

      <label class="day-life__journal">
        <span>{{ t('today.journal') }}</span>
        <textarea
          v-model="journalText"
          rows="3"
          maxlength="2000"
          :placeholder="t('today.journalPlaceholder')"
        ></textarea>
      </label>
      <div class="day-life__journal-foot">
        <small>{{ dirty ? t('common.unsaved') : savedText ? t('common.saved') : '' }}</small>
        <van-button
          size="small"
          type="primary"
          :plain="!dirty"
          :disabled="!dirty"
          :loading="savingJournal"
          @click="save"
        >
          {{ t('dayLife.saveJournal') }}
        </van-button>
      </div>

      <div class="day-life__tasks">
        <h3>
          {{ t('dayLife.tasks') }}
          <small v-if="tasks.length">{{ doneCount }}/{{ tasks.length }}</small>
        </h3>
        <ul v-if="tasks.length">
          <li v-for="task in tasks" :key="`${task.id}-${task.occurrenceDate}`">
            <button
              type="button"
              role="checkbox"
              class="day-life__check"
              :class="{ 'is-done': task.completed }"
              :aria-checked="task.completed"
              :aria-label="t(task.completed ? 'today.untoggleTask' : 'today.toggleTask', { title: task.title })"
              @click="toggle(task)"
            >
              <van-icon v-if="task.completed" name="success" aria-hidden="true" />
            </button>
            <span :class="{ 'is-done': task.completed }">
              {{ task.title }}
              <small v-if="task.repeatType && task.repeatType !== 'NONE'">
                {{ t(`today.repeats.${task.repeatType}`) }}
              </small>
            </span>
          </li>
        </ul>
        <p v-else class="day-life__empty">{{ t('dayLife.noTasks') }}</p>
        <form class="day-life__add" @submit.prevent="quickAdd">
          <input
            v-model="quickTitle"
            type="text"
            maxlength="80"
            enterkeyhint="done"
            :placeholder="t('dayLife.addTaskPlaceholder')"
            :aria-label="t('dayLife.addTaskPlaceholder')"
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
      </div>

      <blockquote v-if="quote" class="day-life__quote">
        {{ quote.content }}
        <footer v-if="quote.source || quote.author">—— {{ quote.source || quote.author }}</footer>
      </blockquote>
    </template>
  </section>
</template>

<style scoped>
.day-life {
  display: grid;
  gap: 12px;
  margin: 0 16px 16px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  background: var(--color-surface);
}
.day-life h2 {
  margin: 0;
  color: var(--color-heading);
  font-size: var(--font-section);
}
.day-life h3 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 4px;
  color: var(--color-heading);
  font-size: 15px;
}
.day-life h3 small {
  color: var(--color-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.day-life__error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--color-danger);
  font-size: 13px;
}
.day-life__moods {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}
.day-life__mood {
  display: grid;
  justify-items: center;
  gap: 2px;
  min-height: var(--touch-target);
  padding: 6px 0;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  color: var(--color-muted);
  font: inherit;
}
.day-life__mood span {
  font-size: 22px;
  line-height: 1.2;
}
.day-life__mood small {
  font-size: 11px;
  white-space: nowrap;
}
.day-life__mood.is-active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.day-life__journal {
  display: grid;
  gap: 6px;
  color: var(--color-muted);
  font-size: 13px;
}
.day-life__journal textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  color: var(--color-heading);
  font: inherit;
  font-size: 15px;
  resize: vertical;
}
.day-life__journal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: -4px;
  color: var(--color-muted);
}
.day-life__tasks ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.day-life__tasks li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  font-size: 15px;
  color: var(--color-heading);
}
.day-life__tasks li small {
  margin-left: 4px;
  color: var(--color-muted);
  font-size: 12px;
}
.day-life__tasks li span.is-done {
  color: var(--color-muted);
  text-decoration: line-through;
}
.day-life__check {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--touch-target);
  height: var(--touch-target);
  margin: -6px 0 -6px -10px;
  padding: 0;
  border: 0;
  background: none;
  color: #fff;
}
.day-life__check::before {
  content: '';
  grid-area: 1 / 1;
  width: 22px;
  height: 22px;
  border: 2px solid var(--color-border);
  border-radius: 50%;
  box-sizing: border-box;
}
.day-life__check .van-icon {
  grid-area: 1 / 1;
  z-index: 1;
}
.day-life__check.is-done::before {
  border-color: var(--color-income);
  background: var(--color-income);
}
.day-life__empty {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
}
.day-life__add {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.day-life__add input {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  font: inherit;
  font-size: 15px;
}
.day-life__quote {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--color-primary-soft);
  color: var(--color-heading);
  font-size: 14px;
  line-height: 1.6;
}
.day-life__quote footer {
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 12px;
}
</style>

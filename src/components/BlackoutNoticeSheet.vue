<script setup>
// 禁休公告：期間＋標題（選填）＋主管公告全文。只是提醒，不影響班表、薪資或集簽天數。
import { computed, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useI18n } from 'vue-i18n'
import { localizeMessage } from '../i18n/messages.js'
import { NOTICE_BODY_MAX, NOTICE_TITLE_MAX, normalizeBlackoutNotice } from '../domain/leaveBlackouts.js'

const { t } = useI18n()
const props = defineProps({
  show: Boolean,
  /** 這天適用的公告（查看模式） */
  notices: { type: Array, default: () => [] },
  /** 新增時的預設日期 */
  date: { type: String, required: true },
  /** async (notice) => 保存後的公告 */
  save: { type: Function, required: true },
  /** async (notice) => void */
  remove: { type: Function, required: true },
})
const emit = defineEmits(['update:show'])

const mode = ref('view')
const form = ref({ id: '', startDate: '', endDate: '', title: '', body: '' })
const editing = ref(null)
const busy = ref(false)

watch(
  () => props.show,
  (show) => {
    if (!show) return
    if (props.notices.length) mode.value = 'view'
    else startCreate()
  },
  { immediate: true },
)

const formTitle = computed(() => (editing.value ? t('blackout.editTitle') : t('payrollPage.addBlackout')))

function startCreate() {
  editing.value = null
  form.value = {
    id: `notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    startDate: props.date,
    endDate: props.date,
    title: '',
    body: '',
  }
  mode.value = 'edit'
}

function startEdit(notice) {
  editing.value = notice
  form.value = {
    // 舊版單日禁休編輯後轉存成新的公告
    id: notice.legacyDate ? `notice-${Date.now()}` : notice.id,
    startDate: notice.startDate,
    endDate: notice.endDate,
    title: notice.title,
    body: notice.body,
  }
  mode.value = 'edit'
}

async function submit() {
  let notice
  try {
    notice = normalizeBlackoutNotice(form.value)
  } catch (error) {
    return showToast(error.message)
  }
  busy.value = true
  try {
    await props.save(notice, editing.value)
    showToast(t('blackout.saved'))
    emit('update:show', false)
  } catch (error) {
    showToast(localizeMessage(error?.message) || t('errors.saveFailed'))
  } finally {
    busy.value = false
  }
}

async function confirmRemove(notice) {
  try {
    await showConfirmDialog({
      title: t('blackout.deleteTitle'),
      message: t('blackout.deleteMessage', { start: notice.startDate, end: notice.endDate }),
    })
  } catch {
    return
  }
  busy.value = true
  try {
    await props.remove(notice)
    showToast(t('shopping.deleted'))
    emit('update:show', false)
  } catch (error) {
    showToast(localizeMessage(error?.message) || t('shopping.deleteFailed'))
  } finally {
    busy.value = false
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
    class="notice-sheet"
    @update:show="emit('update:show', $event)"
  >
    <div class="notice-sheet__body">
      <template v-if="mode === 'view'">
        <h2>{{ t('payrollPage.blackoutNotice') }}</h2>
        <article v-for="notice in notices" :key="notice.id" class="notice-card">
          <p class="notice-card__period">{{ t('blackout.period', { start: notice.startDate, end: notice.endDate }) }}</p>
          <h3>{{ notice.title || t('payrollPage.blackoutTag') }}</h3>
          <p v-if="notice.body" class="notice-card__text">{{ notice.body }}</p>
          <p v-else class="notice-card__empty">{{ t('blackout.noBody') }}</p>
          <div class="notice-card__actions">
            <van-button size="small" plain type="danger" :loading="busy" @click="confirmRemove(notice)">{{ t('common.delete') }}</van-button>
            <van-button size="small" plain type="primary" @click="startEdit(notice)">{{ t('blackout.edit') }}</van-button>
          </div>
        </article>
        <van-button block plain type="primary" class="notice-sheet__primary" @click="startCreate">{{ t('blackout.addAnother') }}</van-button>
      </template>

      <template v-else>
        <h2>{{ formTitle }}</h2>
        <van-cell-group inset>
          <van-field v-model="form.startDate" type="date" :label="t('blackout.start')" required />
          <van-field v-model="form.endDate" type="date" :label="t('blackout.end')" required />
          <van-field
            v-model="form.title"
            :label="t('blackout.titleLabel')"
            :placeholder="t('blackout.titlePlaceholder')"
            :maxlength="NOTICE_TITLE_MAX"
          />
          <van-field
            v-model="form.body"
            type="textarea"
            :label="t('blackout.bodyLabel')"
            :placeholder="t('blackout.bodyPlaceholder')"
            rows="5"
            autosize
            :maxlength="NOTICE_BODY_MAX"
            show-word-limit
          />
        </van-cell-group>
        <p class="notice-sheet__note">{{ t('blackout.note') }}</p>
        <van-button block type="primary" class="notice-sheet__primary" :loading="busy" @click="submit">{{ t('blackout.save') }}</van-button>
      </template>
    </div>
  </van-popup>
</template>

<style scoped>
.notice-sheet__body {
  max-height: 88dvh;
  overflow-y: auto;
  padding: 22px var(--page-inset) calc(16px + env(safe-area-inset-bottom, 0px));
}
h2 {
  margin: 0 0 12px;
  font-size: var(--font-heading);
  color: var(--color-heading);
}
.notice-card {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: var(--radius-medium);
  background: var(--color-pending-soft);
}
.notice-card__period {
  margin: 0;
  color: var(--color-pending);
  font-size: 12px;
  font-weight: 700;
}
.notice-card h3 {
  margin: 4px 0 8px;
  font-size: 16px;
  color: var(--color-heading);
}
.notice-card__text {
  margin: 0;
  color: var(--color-heading);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.notice-card__empty {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
}
.notice-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.notice-sheet__note {
  margin: 10px 4px;
  color: var(--color-muted);
  font-size: var(--font-caption);
}
.notice-sheet__primary {
  margin-top: 12px;
  height: var(--page-button-height);
}
</style>

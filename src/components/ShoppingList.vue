<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import {
  addPurchasedUnits,
  completeShoppingItem,
  createShoppingItem,
  getShoppingSections,
  reopenShoppingItem,
  SHOPPING_PRIORITIES,
  SHOPPING_STORES,
} from '../domain/shopping.js'
import {
  shoppingRepository,
  subscribeToShoppingChanges,
} from '../repositories/shoppingRepository.js'
import { authToken } from '../services/authSession.js'

const props = defineProps({ active: Boolean })
const emit = defineEmits(['navigate'])
const items = ref([])
const loading = ref(false)
const saving = ref(false)
const busyId = ref('')
const quickName = ref('')
const quickField = ref(null)
const isComposing = ref(false)
const selectedBucket = ref('NOW')
const showForm = ref(false)
const showActions = ref(false)
const showPartial = ref(false)
const selectedId = ref('')
const partialQuantity = ref(1)
const completedOpenNow = ref([])
const completedOpenLater = ref([])
const completedOpen = computed({
  get: () => (selectedBucket.value === 'NOW' ? completedOpenNow.value : completedOpenLater.value),
  set: (value) => {
    if (selectedBucket.value === 'NOW') completedOpenNow.value = value
    else completedOpenLater.value = value
  },
})
const advancedOpen = ref([])
const keyboardInset = ref(0)
const visibleHeight = ref(0)
const form = ref(emptyForm())
const initialFormSnapshot = ref('')
const hasUnsavedChanges = computed(() => JSON.stringify(form.value) !== initialFormSnapshot.value)
const undoCandidate = ref(null)
const sections = computed(() => getShoppingSections(items.value))
const pendingItems = computed(() =>
  selectedBucket.value === 'NOW' ? sections.value.now : sections.value.later,
)
const completedItems = computed(() =>
  selectedBucket.value === 'NOW' ? sections.value.completedNow : sections.value.completedLater,
)
const selectedItem = computed(() => items.value.find((item) => item.id === selectedId.value))
const actionChoices = computed(() => {
  const item = selectedItem.value
  if (!item) return []
  return [
    ...(item.purchasedQuantity < item.quantity ? [{ name: '買一部分', id: 'partial' }] : []),
    { name: item.bucket === 'NOW' ? '移到下次買' : '移回這次買', id: 'move' },
    { name: '編輯', id: 'edit' },
    { name: '刪除', id: 'delete', color: 'var(--color-expense)' },
  ]
})
const advancedSummary = computed(() => {
  const details = []
  if (form.value.priority !== 'NORMAL') details.push(priorityLabel(form.value.priority))
  if (form.value.bucket === 'LATER') details.push('下次買')
  if (form.value.store !== 'ANY') details.push(storeLabel(form.value.store))
  if (form.value.note) details.push('有備註')
  return details.join(' · ') || '選填'
})

function emptyForm(bucket = 'NOW') {
  return {
    id: '',
    name: '',
    quantity: 1,
    purchasedQuantity: 0,
    unit: '件',
    priority: 'NORMAL',
    bucket,
    store: 'ANY',
    note: '',
  }
}

function priorityLabel(priority) {
  return SHOPPING_PRIORITIES.find((option) => option.id === priority)?.label || '一般'
}

function storeLabel(store) {
  return SHOPPING_STORES.find((option) => option.id === store)?.label || '不限店家'
}

function updateViewport() {
  const viewport = window.visualViewport
  if (!viewport) return
  keyboardInset.value = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
  visibleHeight.value = viewport.height
}

async function refresh() {
  const identity = authToken.value
  loading.value = true
  try {
    const next = await shoppingRepository.list()
    if (identity === authToken.value) items.value = next
  } catch (error) {
    showToast(error.message || '無法讀取採買清單')
  } finally {
    loading.value = false
  }
}

let unsubscribe
let suppressSubmit = false
let compositionTimer
let undoTimer
onMounted(() => {
  unsubscribe = subscribeToShoppingChanges(() => {
    if (props.active) refresh()
  })
  window.visualViewport?.addEventListener('resize', updateViewport)
  window.visualViewport?.addEventListener('scroll', updateViewport)
  updateViewport()
  if (props.active) refresh()
})
onUnmounted(() => {
  unsubscribe?.()
  window.visualViewport?.removeEventListener('resize', updateViewport)
  window.visualViewport?.removeEventListener('scroll', updateViewport)
  clearTimeout(compositionTimer)
  clearTimeout(undoTimer)
})
watch(
  () => props.active,
  (active) => {
    if (active) refresh()
  },
)
watch(authToken, () => {
  items.value = []
  if (props.active) refresh()
})

function onQuickKeydown(event) {
  if (event.key === 'Enter' && (event.isComposing || isComposing.value || event.keyCode === 229)) {
    suppressSubmit = true
    clearTimeout(compositionTimer)
    compositionTimer = setTimeout(() => {
      suppressSubmit = false
    }, 0)
  }
}

async function quickAdd() {
  if (suppressSubmit || isComposing.value || saving.value || !quickName.value.trim()) return
  saving.value = true
  try {
    await shoppingRepository.save(
      createShoppingItem({
        ...emptyForm(selectedBucket.value),
        id: crypto.randomUUID(),
        name: quickName.value,
      }),
    )
    quickName.value = ''
    await nextTick()
    if (props.active) quickField.value?.focus?.()
  } catch (error) {
    showToast(error.message || '新增失敗')
  } finally {
    saving.value = false
  }
}

function openEditor(item = null) {
  form.value = item ? { ...item } : emptyForm(selectedBucket.value)
  initialFormSnapshot.value = JSON.stringify(form.value)
  advancedOpen.value = []
  showActions.value = false
  showForm.value = true
}

async function requestCloseEditor() {
  if (saving.value || busyId.value) return
  if (hasUnsavedChanges.value) {
    try {
      await showConfirmDialog({
        title: '捨棄未儲存的變更？',
        message: '離開後這些修改不會保存。',
        confirmButtonText: '捨棄變更',
      })
    } catch {
      return
    }
  }
  showForm.value = false
}

function onFormVisibilityChange(visible) {
  if (!visible) requestCloseEditor()
}

function clearUndo() {
  clearTimeout(undoTimer)
  undoCandidate.value = null
}

async function saveItem() {
  if (saving.value) return
  saving.value = true
  try {
    const record = createShoppingItem({ ...form.value, id: form.value.id || crypto.randomUUID() })
    await shoppingRepository.save(record)
    if (undoCandidate.value?.id === record.id) clearUndo()
    showForm.value = false
    showToast(form.value.id ? '已更新' : '已加入清單')
  } catch (error) {
    showToast(error.message || '儲存失敗')
  } finally {
    saving.value = false
  }
}

async function updatePurchased(item, nextItem) {
  if (busyId.value) return false
  busyId.value = item.id
  try {
    await shoppingRepository.save(nextItem)
    return true
  } catch (error) {
    showToast(error.message || '更新失敗')
    return false
  } finally {
    busyId.value = ''
  }
}

async function toggleComplete(item) {
  const completed = item.purchasedQuantity === item.quantity
  if (completed) {
    if (
      (await updatePurchased(item, reopenShoppingItem(item))) &&
      undoCandidate.value?.id === item.id
    )
      clearUndo()
    return
  }
  const next = completeShoppingItem(item)
  if (await updatePurchased(item, next)) {
    clearUndo()
    undoCandidate.value = { id: item.id, name: item.name, previous: item, completed: next }
    undoTimer = setTimeout(clearUndo, 6000)
  }
}

async function undoComplete() {
  const candidate = undoCandidate.value
  if (candidate && (await updatePurchased(candidate.completed, candidate.previous))) clearUndo()
}

async function buyPartial() {
  const item = selectedItem.value
  if (!item || busyId.value) return
  try {
    if (await updatePurchased(item, addPurchasedUnits(item, partialQuantity.value)))
      showPartial.value = false
  } catch (error) {
    showToast(error.message || '數量不正確')
  }
}

async function moveToBucket(item) {
  if (busyId.value) return
  busyId.value = item.id
  try {
    await shoppingRepository.save(
      createShoppingItem({
        ...item,
        bucket: item.bucket === 'NOW' ? 'LATER' : 'NOW',
      }),
    )
    if (undoCandidate.value?.id === item.id) clearUndo()
  } catch (error) {
    showToast(error.message || '更新失敗')
  } finally {
    busyId.value = ''
  }
}

async function removeItem(item) {
  if (!item || saving.value || busyId.value) return
  try {
    await showConfirmDialog({
      title: '刪除採買項目？',
      message: `「${item.name}」和它目前的已買數量都會移除。`,
    })
    busyId.value = item.id
    await shoppingRepository.remove(item.id)
    if (undoCandidate.value?.id === item.id) clearUndo()
    if (form.value.id === item.id) showForm.value = false
    showToast('已刪除')
  } catch (error) {
    if (error !== 'cancel') showToast(error.message || '刪除失敗')
  } finally {
    busyId.value = ''
  }
}

function openActions(item) {
  selectedId.value = item.id
  showActions.value = true
}

function onActionSelect(action) {
  const item = selectedItem.value
  showActions.value = false
  if (!item) return
  if (action.id === 'partial') {
    partialQuantity.value = 1
    showPartial.value = true
  } else if (action.id === 'move') moveToBucket(item)
  else if (action.id === 'edit') openEditor(item)
  else if (action.id === 'delete') removeItem(item)
}
</script>

<template>
  <main class="shopping-page app-page">
    <header class="app-page__header shopping-header">
      <h1>採買清單</h1>
      <span class="shopping-count">待買 {{ sections.remainingCount }} 項</span>
    </header>

    <section class="shopping-add app-page__card" aria-label="快速新增採買項目">
      <form
        class="shopping-add__form"
        @submit.prevent="quickAdd"
        @compositionstart.capture="isComposing = true"
        @compositionend.capture="isComposing = false"
        @keydown.capture="onQuickKeydown"
      >
        <van-field
          ref="quickField"
          v-model="quickName"
          class="shopping-add__input"
          placeholder="要買什麼？"
          maxlength="120"
          clearable
        />
        <van-button
          native-type="submit"
          type="primary"
          :loading="saving"
          :disabled="saving || !quickName.trim()"
          >加入</van-button
        >
      </form>
      <button class="shopping-add__details" type="button" @click="openEditor()">
        設定數量或店家 <van-icon name="arrow" />
      </button>
    </section>

    <div class="shopping-tabs" role="tablist" aria-label="採買安排">
      <button
        type="button"
        id="shopping-tab-now"
        role="tab"
        aria-controls="shopping-list-panel"
        :aria-selected="selectedBucket === 'NOW'"
        :class="{ 'is-selected': selectedBucket === 'NOW' }"
        @click="selectedBucket = 'NOW'"
      >
        這次買 <span>{{ sections.now.length }}</span>
      </button>
      <button
        type="button"
        id="shopping-tab-later"
        role="tab"
        aria-controls="shopping-list-panel"
        :aria-selected="selectedBucket === 'LATER'"
        :class="{ 'is-selected': selectedBucket === 'LATER' }"
        @click="selectedBucket = 'LATER'"
      >
        下次買 <span>{{ sections.later.length }}</span>
      </button>
    </div>

    <section
      id="shopping-list-panel"
      class="shopping-list"
      role="tabpanel"
      :aria-labelledby="selectedBucket === 'NOW' ? 'shopping-tab-now' : 'shopping-tab-later'"
      aria-live="polite"
    >
      <p v-if="loading" class="shopping-empty">正在讀取清單…</p>
      <p v-else-if="!pendingItems.length" class="shopping-empty">
        {{ selectedBucket === 'NOW' ? '這次沒有待買商品。' : '下次買清單還是空的。' }}
      </p>
      <div v-else class="shopping-list__rows app-page__card">
        <article v-for="item in pendingItems" :key="item.id" class="shopping-row">
          <button
            type="button"
            class="shopping-check"
            role="checkbox"
            aria-checked="false"
            :aria-label="`完成${item.name}剩餘的${item.quantity - item.purchasedQuantity}${item.unit}`"
            :disabled="Boolean(busyId)"
            @click.stop="toggleComplete(item)"
          >
            <van-icon name="success" />
          </button>
          <button type="button" class="shopping-row__body" @click="openEditor(item)">
            <strong>{{ item.name }}</strong>
            <span
              v-if="item.purchasedQuantity || item.priority === 'HIGH' || item.store !== 'ANY'"
              class="shopping-row__meta"
            >
              <span v-if="item.priority === 'HIGH'" class="shopping-tag shopping-tag--urgent"
                >急需</span
              >
              <span v-if="item.store !== 'ANY'" class="shopping-tag">{{
                storeLabel(item.store)
              }}</span>
              <span v-if="item.purchasedQuantity"
                >已買 {{ item.purchasedQuantity }}／共 {{ item.quantity }}，還差
                {{ item.quantity - item.purchasedQuantity }}</span
              >
            </span>
          </button>
          <span class="shopping-row__remaining"
            >{{ item.quantity - item.purchasedQuantity }} {{ item.unit }}</span
          >
          <button
            type="button"
            class="shopping-more"
            :aria-label="`${item.name}更多操作`"
            :disabled="Boolean(busyId)"
            @click.stop="openActions(item)"
          >
            <van-icon name="ellipsis" />
          </button>
        </article>
      </div>
    </section>

    <div v-if="undoCandidate" class="shopping-undo" role="status">
      <span>「{{ undoCandidate.name }}」已完成</span>
      <button type="button" :disabled="Boolean(busyId)" @click="undoComplete">復原</button>
    </div>

    <van-collapse v-if="completedItems.length" v-model="completedOpen" class="shopping-completed">
      <van-collapse-item name="completed" :title="`已買完 · ${completedItems.length} 項`">
        <div v-for="item in completedItems" :key="item.id" class="shopping-row shopping-row--done">
          <button
            type="button"
            class="shopping-check is-checked"
            role="checkbox"
            aria-checked="true"
            :aria-label="`取消完成${item.name}`"
            :disabled="Boolean(busyId)"
            @click.stop="toggleComplete(item)"
          >
            <van-icon name="success" />
          </button>
          <button type="button" class="shopping-row__body" @click="openEditor(item)">
            <strong>{{ item.name }}</strong>
          </button>
          <span class="shopping-row__remaining">{{ item.quantity }} {{ item.unit }}</span>
          <button
            type="button"
            class="shopping-more"
            :aria-label="`${item.name}更多操作`"
            :disabled="Boolean(busyId)"
            @click.stop="openActions(item)"
          >
            <van-icon name="ellipsis" />
          </button>
        </div>
      </van-collapse-item>
    </van-collapse>

    <div class="shopping-expense">
      <span>勾選商品不會自動記成支出。</span>
      <button type="button" @click="emit('navigate', 'expenses')">
        去記支出 <van-icon name="arrow" />
      </button>
    </div>

    <van-action-sheet
      v-model:show="showActions"
      :actions="actionChoices"
      cancel-text="取消"
      close-on-click-action
      safe-area-inset-bottom
      @select="onActionSelect"
    />

    <van-popup
      v-model:show="showPartial"
      class="shopping-popup"
      position="bottom"
      round
      :style="{ bottom: `${keyboardInset}px` }"
    >
      <div v-if="selectedItem" class="shopping-short-sheet">
        <h2>買一部分</h2>
        <p>
          {{ selectedItem.name }} · 還差
          {{ selectedItem.quantity - selectedItem.purchasedQuantity }} {{ selectedItem.unit }}
        </p>
        <van-stepper
          v-model="partialQuantity"
          min="1"
          :max="selectedItem.quantity - selectedItem.purchasedQuantity"
        />
        <van-button block type="primary" :loading="busyId === selectedItem.id" @click="buyPartial"
          >記下這次買到的數量</van-button
        >
      </div>
    </van-popup>

    <van-popup
      :show="showForm"
      class="shopping-popup"
      position="bottom"
      round
      :close-on-click-overlay="false"
      :style="{ bottom: `${keyboardInset}px` }"
      @update:show="onFormVisibilityChange"
    >
      <form
        class="shopping-sheet"
        :style="visibleHeight ? { maxHeight: `${Math.max(120, visibleHeight - 12)}px` } : null"
        @submit.prevent="saveItem"
      >
        <div class="shopping-sheet__header">
          <h2>{{ form.id ? '編輯採買項目' : '新增採買項目' }}</h2>
          <button type="button" aria-label="關閉採買項目表單" @click="requestCloseEditor">
            <van-icon name="cross" />
          </button>
        </div>
        <van-field
          v-model="form.name"
          label="品名"
          placeholder="例如：牛奶"
          maxlength="120"
          required
        />
        <div class="shopping-sheet__quantity">
          <label>數量</label>
          <van-stepper v-model="form.quantity" min="1" max="999" />
          <van-field
            v-model="form.unit"
            class="shopping-sheet__unit"
            aria-label="單位"
            maxlength="20"
            placeholder="單位"
          />
        </div>
        <p v-if="form.purchasedQuantity" class="shopping-sheet__hint">
          已買 {{ form.purchasedQuantity }} {{ form.unit }}；目標數量不可少於已買數量。
        </p>

        <van-collapse v-model="advancedOpen" class="shopping-sheet__advanced">
          <van-collapse-item name="settings" title="更多設定" :value="advancedSummary">
            <div class="shopping-sheet__group">
              <strong>優先順序</strong>
              <van-radio-group v-model="form.priority" direction="horizontal">
                <van-radio
                  v-for="option in SHOPPING_PRIORITIES"
                  :key="option.id"
                  :name="option.id"
                  >{{ option.label }}</van-radio
                >
              </van-radio-group>
            </div>
            <div class="shopping-sheet__group">
              <strong>採買安排</strong>
              <van-radio-group v-model="form.bucket" direction="horizontal">
                <van-radio name="NOW">這次買</van-radio>
                <van-radio name="LATER">下次買</van-radio>
              </van-radio-group>
            </div>
            <div class="shopping-sheet__group">
              <strong>偏好店家</strong>
              <van-radio-group
                v-model="form.store"
                direction="horizontal"
                class="shopping-sheet__stores"
              >
                <van-radio v-for="option in SHOPPING_STORES" :key="option.id" :name="option.id">{{
                  option.label
                }}</van-radio>
              </van-radio-group>
            </div>
            <van-field
              v-model="form.note"
              label="備註"
              type="textarea"
              rows="2"
              autosize
              maxlength="240"
              placeholder="品牌、規格等"
            />
          </van-collapse-item>
        </van-collapse>

        <div class="shopping-sheet__actions">
          <van-button block type="primary" native-type="submit" :loading="saving"
            >儲存項目</van-button
          >
          <button
            v-if="form.id"
            type="button"
            class="shopping-sheet__delete"
            :disabled="saving || Boolean(busyId)"
            @click="removeItem(form)"
          >
            刪除這項
          </button>
        </div>
      </form>
    </van-popup>
  </main>
</template>

<style scoped>
.shopping-page {
  max-width: 820px;
}
.shopping-header {
  align-items: baseline;
}
.shopping-count {
  flex: none;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 700;
}
.shopping-add {
  padding: 10px 12px;
}
.shopping-add__form {
  display: flex;
  gap: 8px;
}
.shopping-add__input {
  flex: 1;
  min-width: 0;
  border-radius: 11px;
  background: #f4f8fd;
}
.shopping-add__form :deep(.van-button) {
  flex: none;
  min-width: 68px;
  min-height: 44px;
  border-radius: 11px;
}
.shopping-add__details {
  margin-top: 5px;
  padding: 7px 2px;
  border: 0;
  background: none;
  color: #166dd1;
  font-size: 12px;
  font-weight: 700;
}
.shopping-expense button {
  min-height: 40px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: #166dd1;
  font-size: 12px;
  font-weight: 700;
}
.shopping-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin: 18px 0 10px;
  padding: 4px;
  border-radius: 13px;
  background: #eaf1fa;
}
.shopping-tabs button {
  min-height: 44px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #52667e;
  font-size: 14px;
  font-weight: 700;
}
.shopping-tabs button.is-selected {
  background: #fff;
  color: #1768bd;
  box-shadow: 0 2px 8px rgba(31, 75, 122, 0.09);
}
.shopping-tabs span {
  margin-left: 4px;
  font-size: 12px;
}
.shopping-empty {
  margin: 0;
  padding: 22px 12px;
  color: var(--color-muted);
  font-size: 13px;
  text-align: center;
}
.shopping-list__rows {
  overflow: hidden;
  padding: 0 12px;
}
.shopping-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 54px;
  padding: 5px 0;
  border-bottom: 1px solid var(--color-border);
}
.shopping-row:last-child {
  border-bottom: 0;
}
.shopping-check {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 44px;
  border: 0;
  background: none;
  color: transparent;
}
.shopping-check .van-icon {
  display: grid;
  place-items: center;
  width: 23px;
  height: 23px;
  border: 2px solid #a3b6ca;
  border-radius: 7px;
  font-size: 15px;
}
.shopping-check.is-checked .van-icon {
  border-color: #16825e;
  background: #16825e;
  color: #fff;
}
.shopping-row__body {
  flex: 1;
  min-width: 0;
  padding: 5px 0;
  border: 0;
  background: none;
  text-align: left;
}
.shopping-row__body strong {
  display: block;
  overflow-wrap: anywhere;
  color: var(--color-heading);
  font-size: 15px;
  line-height: 1.35;
}
.shopping-row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.35;
}
.shopping-tag {
  padding: 2px 5px;
  border-radius: 6px;
  background: #edf2f8;
  color: #455c75;
}
.shopping-tag--urgent {
  background: #fff0e4;
  color: #ad520b;
}
.shopping-row__remaining {
  flex: none;
  max-width: 65px;
  color: #52667e;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.shopping-more {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 44px;
  border: 0;
  background: none;
  color: #52667e;
  font-size: 20px;
}
.shopping-completed {
  margin-top: 12px;
  border-radius: 14px;
  overflow: hidden;
}
.shopping-undo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  margin-top: 10px;
  padding: 0 10px;
  border-radius: 10px;
  background: #eaf3fe;
  color: #345474;
  font-size: 12px;
}
.shopping-undo span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.shopping-undo button {
  flex: none;
  min-width: 48px;
  min-height: 40px;
  border: 0;
  background: none;
  color: #166dd1;
  font-weight: 800;
}
.shopping-completed :deep(.van-collapse-item__content) {
  padding: 0 12px;
}
.shopping-row--done .shopping-row__body strong {
  color: var(--color-muted);
  text-decoration: line-through;
}
.shopping-expense {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
  margin: 18px 2px 0;
  color: var(--color-muted);
  font-size: 12px;
}
.shopping-short-sheet {
  display: grid;
  gap: 12px;
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
}
.shopping-short-sheet h2 {
  margin: 0;
  font-size: 20px;
}
.shopping-short-sheet p {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
}
.shopping-short-sheet :deep(.van-stepper) {
  justify-self: start;
}
.shopping-short-sheet :deep(.van-button) {
  min-height: 48px;
  border-radius: 12px;
}
.shopping-sheet {
  max-height: 88dvh;
  overflow-y: auto;
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
  overscroll-behavior: contain;
}
.shopping-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.shopping-sheet__header h2 {
  margin: 0;
  font-size: 20px;
}
.shopping-sheet__header button {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  background: none;
  color: var(--color-muted);
  font-size: 18px;
}
.shopping-sheet__quantity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 12px 16px;
}
.shopping-sheet__quantity label {
  flex: 1;
  min-width: 50px;
  color: var(--color-muted);
  font-size: 14px;
}
.shopping-sheet__unit {
  width: 76px;
  padding: 8px;
  border-radius: 8px;
  background: #f4f8fd;
}
.shopping-sheet__hint {
  margin: 2px 16px 10px;
  color: var(--color-muted);
  font-size: 12px;
}
.shopping-sheet__advanced {
  margin-top: 5px;
  border-top: 1px solid var(--color-border);
}
.shopping-sheet__advanced :deep(.van-cell__value) {
  overflow-wrap: anywhere;
  font-size: 11px;
}
.shopping-sheet__advanced :deep(.van-collapse-item__content) {
  padding: 0 0 10px;
}
.shopping-sheet__group {
  display: grid;
  gap: 10px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--color-border);
}
.shopping-sheet__group strong {
  font-size: 14px;
}
.shopping-sheet__group :deep(.van-radio-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}
.shopping-sheet__stores :deep(.van-radio) {
  flex: 0 1 auto;
  max-width: 100%;
  margin: 0;
  padding: 7px 9px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
}
.shopping-sheet__stores :deep(.van-radio__label) {
  margin-left: 5px;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.shopping-sheet__actions {
  position: sticky;
  bottom: 0;
  display: grid;
  gap: 2px;
  margin-top: 12px;
  padding: 10px 0 calc(10px + env(safe-area-inset-bottom));
  background: #fff;
}
.shopping-sheet__actions :deep(.van-button) {
  min-height: 48px;
  border-radius: 12px;
}
.shopping-sheet__delete {
  justify-self: center;
  min-height: 40px;
  padding: 0 14px;
  border: 0;
  background: none;
  color: #a95a5a;
  font-size: 12px;
}
@media (min-width: 600px) {
  :global(.shopping-popup.van-popup--bottom) {
    left: 50%;
    width: min(100vw, 520px);
    transform: translateX(-50%);
  }
}
</style>

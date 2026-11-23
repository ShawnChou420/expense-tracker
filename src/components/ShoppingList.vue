<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useI18n } from 'vue-i18n'
import { localizeMessage } from '../i18n/messages.js'
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
  defaultPurchasedQuantities,
  estimateShoppingTotals,
  purchasedEstimate,
} from '../domain/shoppingLists.js'
import { dollarsToCents, formatAud, formatCentsInput } from '../domain/money.js'
import { formatLocalDate, parseLocalDate } from '../domain/date.js'
import {
  shoppingRepository,
  subscribeToShoppingChanges,
} from '../repositories/shoppingRepository.js'
import { authToken } from '../services/authSession.js'
import SupermarketSpecials from './SupermarketSpecials.vue'

const props = defineProps({ active: Boolean })
const { t } = useI18n()
const emit = defineEmits(['navigate'])
const items = ref([])
const listId = ref('')
const pageTab = ref('LIST')
const showComplete = ref(false)
const completing = ref(false)
const completeForm = ref({ amount: '', date: '' })
/** 完成採買時確認的實際購買數量：品項 ID → 數量 */
const completeQuantities = ref({})
const amountEdited = ref(false)
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
const totals = computed(() => estimateShoppingTotals(items.value))
const nowItems = computed(() => items.value.filter((item) => item.bucket === 'NOW'))
const confirmEstimate = computed(() => purchasedEstimate(nowItems.value, completeQuantities.value))
const carryOverCount = computed(
  () =>
    items.value.filter((item) =>
      item.bucket === 'NOW'
        ? (completeQuantities.value[item.id] ?? 0) < item.quantity
        : item.purchasedQuantity < item.quantity,
    ).length,
)
watch(confirmEstimate, (estimate) => {
  if (showComplete.value && !amountEdited.value)
    completeForm.value.amount = estimate.cents ? formatCentsInput(estimate.cents) : ''
})
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
    ...(item.purchasedQuantity < item.quantity ? [{ name: t('shopping.partial'), id: 'partial' }] : []),
    { name: item.bucket === 'NOW' ? t('shopping.moveToLater') : t('shopping.moveToNow'), id: 'move' },
    { name: t('shopping.edit'), id: 'edit' },
    { name: t('common.delete'), id: 'delete', color: 'var(--color-expense)' },
  ]
})
const advancedSummary = computed(() => {
  const details = []
  if (form.value.priority !== 'NORMAL') details.push(priorityLabel(form.value.priority))
  if (form.value.bucket === 'LATER') details.push(t('shopping.buyLater'))
  if (form.value.store !== 'ANY') details.push(storeLabel(form.value.store))
  if (form.value.note) details.push(t('shopping.hasNote'))
  return details.join(' · ') || t('common.optional')
})

function emptyForm(bucket = 'NOW') {
  return {
    id: '',
    name: '',
    quantity: 1,
    purchasedQuantity: 0,
    unit: t('shopping.defaultUnit'),
    priority: 'NORMAL',
    bucket,
    store: 'ANY',
    note: '',
    promotionId: null,
    packageSize: null,
    estimatedUnitPriceCents: null,
    actualUnitPriceCents: null,
    priceInput: '',
  }
}

function toFormValue(item) {
  return {
    ...item,
    priceInput:
      item.estimatedUnitPriceCents === null ? '' : formatCentsInput(item.estimatedUnitPriceCents),
  }
}

function fromFormValue(value) {
  const { priceInput, ...item } = value
  const text = String(priceInput ?? '').trim()
  const cents = text === '' ? null : dollarsToCents(text)
  if (text !== '' && cents === null) throw new Error(t('shopping.invalidPrice'))
  return { ...item, estimatedUnitPriceCents: cents }
}

function priceLine(item) {
  if (item.estimatedUnitPriceCents === null) return ''
  const quantity = item.quantity - item.purchasedQuantity
  return quantity > 1
    ? `${formatAud(item.estimatedUnitPriceCents)} × ${quantity}`
    : formatAud(item.estimatedUnitPriceCents)
}

function priorityLabel(priority) {
  return SHOPPING_PRIORITIES.some((option) => option.id === priority)
    ? t(`shopping.priorities.${priority}`)
    : t('shopping.priorities.NORMAL')
}

function storeLabel(store) {
  if (store === 'ANY' || store === 'OTHER') return t(`shopping.stores.${store}`)
  return SHOPPING_STORES.find((option) => option.id === store)?.label || t('shopping.stores.ANY')
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
    const list = await shoppingRepository.active()
    if (identity === authToken.value) {
      items.value = list.items
      listId.value = list.id
    }
  } catch (error) {
    showToast(localizeMessage(error.message) || t('shopping.loadFailed'))
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
    await shoppingRepository.add(
      createShoppingItem({
        ...fromFormValue(emptyForm(selectedBucket.value)),
        id: crypto.randomUUID(),
        name: quickName.value,
      }),
    )
    quickName.value = ''
    await nextTick()
    if (props.active) quickField.value?.focus?.()
  } catch (error) {
    showToast(localizeMessage(error.message) || t('shopping.addFailed'))
  } finally {
    saving.value = false
  }
}

function openEditor(item = null) {
  form.value = item ? toFormValue(item) : emptyForm(selectedBucket.value)
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
        title: t('common.unsavedChangesTitle'),
        message: t('common.unsavedChangesBody'),
        confirmButtonText: t('common.discard'),
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
    const record = createShoppingItem({
      ...fromFormValue(form.value),
      id: form.value.id || crypto.randomUUID(),
    })
    if (form.value.id) await shoppingRepository.save(record)
    else await shoppingRepository.add(record)
    if (undoCandidate.value?.id === record.id) clearUndo()
    showForm.value = false
    showToast(form.value.id ? t('shopping.updated') : t('shopping.addedToList'))
  } catch (error) {
    showToast(localizeMessage(error.message) || t('errors.saveFailed'))
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
    showToast(localizeMessage(error.message) || t('shopping.updateFailed'))
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
    undoCandidate.value = {
      id: item.id,
      name: item.name,
      previous: item,
      completed: next,
    }
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
    showToast(localizeMessage(error.message) || t('shopping.invalidQuantity'))
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
    showToast(localizeMessage(error.message) || t('shopping.updateFailed'))
  } finally {
    busyId.value = ''
  }
}

async function removeItem(item) {
  if (!item || saving.value || busyId.value) return
  try {
    await showConfirmDialog({
      title: t('shopping.deleteTitle'),
      message: t('shopping.deleteMessage', { name: item.name }),
    })
    busyId.value = item.id
    await shoppingRepository.remove(item.id)
    if (undoCandidate.value?.id === item.id) clearUndo()
    if (form.value.id === item.id) showForm.value = false
    showToast(t('shopping.deleted'))
  } catch (error) {
    if (error !== 'cancel') showToast(localizeMessage(error.message) || t('shopping.deleteFailed'))
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

function openComplete() {
  if (!nowItems.value.length) {
    showToast(t('shopping.emptyNow'))
    return
  }
  completeQuantities.value = defaultPurchasedQuantities(items.value)
  amountEdited.value = false
  const estimate = purchasedEstimate(nowItems.value, completeQuantities.value)
  completeForm.value = {
    amount: estimate.cents ? formatCentsInput(estimate.cents) : '',
    date: formatLocalDate(new Date()),
  }
  showComplete.value = true
}

async function confirmComplete() {
  if (completing.value) return
  const amountCents = dollarsToCents(completeForm.value.amount)
  if (!amountCents) {
    showToast(t('shopping.enterSpent'))
    return
  }
  if (!parseLocalDate(completeForm.value.date)) {
    showToast(t('errors.invalidDate'))
    return
  }
  const itemCount = confirmEstimate.value.count
  if (!itemCount) {
    showToast(t('shopping.atLeastOne'))
    return
  }
  completing.value = true
  try {
    // 先把確認後的實際購買數量存回清單，再完成（完成時以清單上的已買數量為準）
    for (const item of nowItems.value) {
      const quantity = completeQuantities.value[item.id] ?? 0
      if (quantity !== item.purchasedQuantity)
        await shoppingRepository.save({ ...item, purchasedQuantity: quantity })
    }
    const result = await shoppingRepository.complete({
      listId: listId.value,
      date: completeForm.value.date,
      amountCents,
      itemCount,
    })
    showComplete.value = false
    clearUndo()
    showToast(result.alreadyCompleted ? t('shopping.alreadyCompleted') : t('shopping.loggedExpense'))
  } catch (error) {
    showToast(localizeMessage(error.message) || t('shopping.completeFailed'))
  } finally {
    completing.value = false
  }
}
</script>

<template>
  <main class="shopping-page app-page">
    <header class="app-page__header shopping-header">
      <h1>{{ t('shopping.pageTitle') }}</h1>
      <span v-if="pageTab === 'LIST'" class="shopping-count"
        >{{ t('shopping.toBuyCount', { count: sections.remainingCount }) }}</span
      >
    </header>

    <div class="shopping-page-tabs" role="tablist" :aria-label="t('shopping.pageTabsAria')">
      <button
        type="button"
        role="tab"
        :aria-selected="pageTab === 'LIST'"
        :class="{ 'is-selected': pageTab === 'LIST' }"
        @click="pageTab = 'LIST'"
      >
        {{ t('shopping.myList') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="pageTab === 'SPECIALS'"
        :class="{ 'is-selected': pageTab === 'SPECIALS' }"
        @click="pageTab = 'SPECIALS'"
      >
        {{ t('shopping.weeklySpecials') }}
      </button>
    </div>

    <SupermarketSpecials
      v-show="pageTab === 'SPECIALS'"
      :active="active && pageTab === 'SPECIALS'"
      @open-list="pageTab = 'LIST'"
    />

    <div v-show="pageTab === 'LIST'">
      <section class="shopping-add app-page__card" :aria-label="t('shopping.quickAddAria')">
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
            :placeholder="t('shopping.addPlaceholder')"
            maxlength="120"
            clearable
          />
          <van-button
            native-type="submit"
            type="primary"
            :loading="saving"
            :disabled="saving || !quickName.trim()"
            >{{ t('shopping.add') }}</van-button
          >
        </form>
        <button class="shopping-add__details" type="button" @click="openEditor()">
          {{ t('shopping.moreSettings') }} <van-icon name="arrow" />
        </button>
      </section>

      <div class="shopping-tabs" role="tablist" :aria-label="t('shopping.bucketsAria')">
        <button
          type="button"
          id="shopping-tab-now"
          role="tab"
          aria-controls="shopping-list-panel"
          :aria-selected="selectedBucket === 'NOW'"
          :class="{ 'is-selected': selectedBucket === 'NOW' }"
          @click="selectedBucket = 'NOW'"
        >
          {{ t('shopping.buyNow') }} <span>{{ sections.now.length }}</span>
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
          {{ t('shopping.buyLater') }} <span>{{ sections.later.length }}</span>
        </button>
      </div>

      <section
        id="shopping-list-panel"
        class="shopping-list"
        role="tabpanel"
        :aria-labelledby="selectedBucket === 'NOW' ? 'shopping-tab-now' : 'shopping-tab-later'"
        aria-live="polite"
      >
        <p v-if="loading" class="shopping-empty">{{ t('shopping.loadingList') }}</p>
        <p v-else-if="!pendingItems.length" class="shopping-empty">
          {{ selectedBucket === 'NOW' ? t('shopping.nowEmpty') : t('shopping.laterEmpty') }}
        </p>
        <div v-else class="shopping-list__rows app-page__card">
          <article v-for="item in pendingItems" :key="item.id" class="shopping-row">
            <button
              type="button"
              class="shopping-check"
              role="checkbox"
              aria-checked="false"
              :aria-label="t('shopping.completeRemainingAria', { name: item.name, count: item.quantity - item.purchasedQuantity, unit: item.unit })"
              :disabled="Boolean(busyId)"
              @click.stop="toggleComplete(item)"
            >
              <van-icon name="success" />
            </button>
            <button type="button" class="shopping-row__body" @click="openEditor(item)">
              <strong>{{ item.name }}</strong>
              <span
                v-if="
                  item.purchasedQuantity ||
                  item.priority === 'HIGH' ||
                  item.store !== 'ANY' ||
                  item.promotionId ||
                  item.packageSize ||
                  item.estimatedUnitPriceCents !== null
                "
                class="shopping-row__meta"
              >
                <span v-if="item.promotionId" class="shopping-tag shopping-tag--special">{{ t('shopping.special') }}</span>
                <span v-if="item.priority === 'HIGH'" class="shopping-tag shopping-tag--urgent"
                  >{{ t('shopping.urgent') }}</span
                >
                <span v-if="item.packageSize">{{ item.packageSize }}</span>
                <span v-if="priceLine(item)" class="shopping-row__price">{{
                  priceLine(item)
                }}</span>
                <span v-if="item.store !== 'ANY'" class="shopping-tag">{{
                  storeLabel(item.store)
                }}</span>
                <span v-if="item.purchasedQuantity"
                  >{{ t('shopping.boughtProgress', { bought: item.purchasedQuantity, total: item.quantity, left: item.quantity - item.purchasedQuantity }) }}</span
                >
              </span>
            </button>
            <span class="shopping-row__remaining"
              >{{ item.quantity - item.purchasedQuantity }} {{ item.unit }}</span
            >
            <button
              type="button"
              class="shopping-more"
              :aria-label="t('shopping.moreActionsAria', { name: item.name })"
              :disabled="Boolean(busyId)"
              @click.stop="openActions(item)"
            >
              <van-icon name="ellipsis" />
            </button>
          </article>
        </div>
      </section>

      <div v-if="undoCandidate" class="shopping-undo" role="status">
        <span>{{ t('shopping.itemCompleted', { name: undoCandidate.name }) }}</span>
        <button type="button" :disabled="Boolean(busyId)" @click="undoComplete">{{ t('shopping.undo') }}</button>
      </div>

      <van-collapse v-if="completedItems.length" v-model="completedOpen" class="shopping-completed">
        <van-collapse-item name="completed" :title="t('shopping.completedCount', { count: completedItems.length })">
          <div
            v-for="item in completedItems"
            :key="item.id"
            class="shopping-row shopping-row--done"
          >
            <button
              type="button"
              class="shopping-check is-checked"
              role="checkbox"
              aria-checked="true"
              :aria-label="t('shopping.uncompleteAria', { name: item.name })"
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
              :aria-label="t('shopping.moreActionsAria', { name: item.name })"
              :disabled="Boolean(busyId)"
              @click.stop="openActions(item)"
            >
              <van-icon name="ellipsis" />
            </button>
          </div>
        </van-collapse-item>
      </van-collapse>

      <div class="shopping-expense">
        <span>{{ t('shopping.noAutoExpense') }}</span>
        <button type="button" @click="emit('navigate', 'expenses')">
          {{ t('shopping.viewExpenses') }} <van-icon name="arrow" />
        </button>
      </div>

      <div class="shopping-total" role="region" :aria-label="t('shopping.estimateAria')">
        <div class="shopping-total__numbers">
          <span>{{ t('shopping.thisEstimate') }}</span>
          <strong>{{ formatAud(totals.estimatedCents) }}</strong>
          <small v-if="totals.unpricedCount">{{ t('shopping.unpricedCount', { count: totals.unpricedCount }) }}</small>
          <small v-else-if="totals.purchasedCount"
            >{{ t('shopping.boughtSummary', { count: totals.purchasedCount, amount: formatAud(totals.purchasedCents) }) }}</small
          >
        </div>
        <van-button
          type="primary"
          class="shopping-total__done"
          :disabled="!nowItems.length || completing"
          @click="openComplete"
          >{{ t('shopping.finish') }}</van-button
        >
      </div>
    </div>

    <van-action-sheet
      v-model:show="showActions"
      :actions="actionChoices"
      :cancel-text="t('common.cancel')"
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
        <h2>{{ t('shopping.partial') }}</h2>
        <p>
          {{ t('shopping.partialRemaining', { name: selectedItem.name, left: selectedItem.quantity - selectedItem.purchasedQuantity, unit: selectedItem.unit }) }}
        </p>
        <van-stepper
          v-model="partialQuantity"
          min="1"
          :max="selectedItem.quantity - selectedItem.purchasedQuantity"
        />
        <van-button block type="primary" :loading="busyId === selectedItem.id" @click="buyPartial"
          >{{ t('shopping.recordPartial') }}</van-button
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
          <h2>{{ form.id ? t('shopping.editItem') : t('shopping.newItem') }}</h2>
          <button type="button" :aria-label="t('shopping.closeEditorAria')" @click="requestCloseEditor">
            <van-icon name="cross" />
          </button>
        </div>
        <van-field
          v-model="form.name"
          :label="t('shopping.itemName')"
          :placeholder="t('shopping.itemPlaceholder')"
          :maxlength="form.promotionId ? 200 : 120"
          required
        />
        <div class="shopping-sheet__quantity">
          <label>{{ t('shopping.quantity') }}</label>
          <van-stepper v-model="form.quantity" min="1" max="999" />
          <van-field
            v-model="form.unit"
            class="shopping-sheet__unit"
            :aria-label="t('shopping.unit')"
            maxlength="20"
            :placeholder="t('shopping.unit')"
          />
        </div>
        <van-field
          v-model="form.priceInput"
          :label="t('shopping.estimatedPrice')"
          type="number"
          inputmode="decimal"
          :placeholder="t('shopping.pricePlaceholder')"
          :disabled="Boolean(form.promotionId)"
        >
          <template #left-icon>$</template>
        </van-field>
        <p v-if="form.promotionId" class="shopping-sheet__hint">
          {{ t('shopping.specialPriceNote', { size: form.packageSize ? `（${form.packageSize}）` : '' }) }}
        </p>
        <p v-if="form.purchasedQuantity" class="shopping-sheet__hint">
          {{ t('shopping.boughtMinimum', { count: form.purchasedQuantity, unit: form.unit }) }}
        </p>

        <van-collapse v-model="advancedOpen" class="shopping-sheet__advanced">
          <van-collapse-item name="settings" :title="t('shopping.advanced')" :value="advancedSummary">
            <div class="shopping-sheet__group">
              <strong>{{ t('shopping.priority') }}</strong>
              <van-radio-group v-model="form.priority" direction="horizontal">
                <van-radio
                  v-for="option in SHOPPING_PRIORITIES"
                  :key="option.id"
                  :name="option.id"
                  >{{ t(`shopping.priorities.${option.id}`) }}</van-radio
                >
              </van-radio-group>
            </div>
            <div class="shopping-sheet__group">
              <strong>{{ t('shopping.bucketsAria') }}</strong>
              <van-radio-group v-model="form.bucket" direction="horizontal">
                <van-radio name="NOW">{{ t('shopping.buyNow') }}</van-radio>
                <van-radio name="LATER">{{ t('shopping.buyLater') }}</van-radio>
              </van-radio-group>
            </div>
            <div class="shopping-sheet__group">
              <strong>{{ t('shopping.preferredStore') }}</strong>
              <van-radio-group
                v-model="form.store"
                direction="horizontal"
                class="shopping-sheet__stores"
              >
                <van-radio v-for="option in SHOPPING_STORES" :key="option.id" :name="option.id">{{
                  storeLabel(option.id)
                }}</van-radio>
              </van-radio-group>
            </div>
            <van-field
              v-model="form.note"
              :label="t('common.note')"
              type="textarea"
              rows="2"
              autosize
              maxlength="240"
              :placeholder="t('shopping.notePlaceholder')"
            />
          </van-collapse-item>
        </van-collapse>

        <div class="shopping-sheet__actions">
          <van-button block type="primary" native-type="submit" :loading="saving"
            >{{ t('shopping.saveItem') }}</van-button
          >
          <button
            v-if="form.id"
            type="button"
            class="shopping-sheet__delete"
            :disabled="saving || Boolean(busyId)"
            @click="removeItem(form)"
          >
            {{ t('shopping.deleteItem') }}
          </button>
        </div>
      </form>
    </van-popup>
    <van-popup
      v-model:show="showComplete"
      class="shopping-popup"
      position="bottom"
      round
      :close-on-click-overlay="!completing"
      :style="{ bottom: `${keyboardInset}px` }"
    >
      <form class="shopping-sheet" @submit.prevent="confirmComplete">
        <div class="shopping-sheet__header">
          <h2>{{ t('shopping.finish') }}</h2>
          <button
            type="button"
            :aria-label="t('shopping.closeFinishAria')"
            :disabled="completing"
            @click="showComplete = false"
          >
            <van-icon name="cross" />
          </button>
        </div>
        <p class="shopping-sheet__hint">{{ t('shopping.confirmQuantities') }}</p>
        <ul class="shopping-receipt">
          <li v-for="item in nowItems" :key="item.id">
            <span
              >{{ item.name }}
              <small v-if="item.estimatedUnitPriceCents !== null">{{
                formatAud(item.estimatedUnitPriceCents)
              }}</small></span
            >
            <van-stepper
              v-model="completeQuantities[item.id]"
              :min="0"
              :max="item.quantity"
              integer
              button-size="28"
              :aria-label="t('shopping.boughtQuantityAria', { name: item.name })"
            />
          </li>
        </ul>
        <p class="shopping-sheet__hint">
          {{ t('shopping.estimateLine', { amount: formatAud(confirmEstimate.cents) }) }}
          <template v-if="confirmEstimate.unpriced">{{
            t('shopping.unpricedNote', { count: confirmEstimate.unpriced })
          }}</template
          >{{ t('shopping.fillFromReceipt') }}
        </p>
        <van-field
          v-model="completeForm.amount"
          :label="t('shopping.actualSpent')"
          @update:model-value="amountEdited = true"
          type="number"
          inputmode="decimal"
          :placeholder="t('shopping.spentPlaceholder')"
          required
        >
          <template #left-icon>$</template>
        </van-field>
        <van-field v-model="completeForm.date" :label="t('common.date')" type="date" required />
        <p v-if="carryOverCount" class="shopping-sheet__hint">
          {{ t('shopping.carryOver', { count: carryOverCount }) }}
        </p>
        <div class="shopping-sheet__actions">
          <van-button block type="primary" native-type="submit" :loading="completing"
            >{{ t('shopping.logExpense') }}</van-button
          >
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
.shopping-page-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin: 0 0 14px;
  padding: 4px;
  border-radius: 13px;
  background: #eaf1fa;
}
.shopping-page-tabs button {
  min-height: 42px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #52667e;
  font-size: 14px;
  font-weight: 700;
}
.shopping-page-tabs button.is-selected {
  background: #fff;
  color: var(--color-primary);
  box-shadow: 0 1px 3px rgb(15 40 80 / 12%);
}
.shopping-tag--special {
  background: #fdecec;
  color: #c43a3a;
}
.shopping-row__price {
  color: #3c4f66;
  font-weight: 700;
}
.shopping-total {
  position: sticky;
  bottom: calc(var(--van-tabbar-height, 50px) + env(safe-area-inset-bottom, 0px) + 8px);
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 4px 14px rgb(15 40 80 / 10%);
}
.shopping-total__numbers {
  display: grid;
  min-width: 0;
}
.shopping-total__numbers span,
.shopping-total__numbers small {
  color: var(--color-muted);
  font-size: 12px;
}
.shopping-total__numbers strong {
  color: var(--color-text);
  font-size: 20px;
}
.shopping-total__done {
  flex: none;
  min-height: 44px;
  border-radius: 12px;
}
.shopping-receipt {
  display: grid;
  gap: 6px;
  margin: 4px 0 8px;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.shopping-receipt li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.shopping-receipt small {
  margin-left: 4px;
  color: var(--color-muted);
}
.shopping-receipt li span:first-child {
  overflow-wrap: anywhere;
}
.shopping-receipt li span:last-child {
  flex: none;
  color: var(--color-muted);
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

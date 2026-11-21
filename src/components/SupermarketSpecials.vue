<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { showToast } from 'vant'
import { useI18n } from 'vue-i18n'
import { localizeMessage } from '../i18n/messages.js'
import { formatAud } from '../domain/money.js'
import { selectionSummary } from '../domain/shoppingLists.js'
import {
  describeSyncStatus,
  discountPercent,
  isHalfPrice,
  PROMOTION_TYPE_LABELS,
  promotionEndLabel,
  savingsCents,
  SPECIAL_SORTS,
  specialSubtitle,
  specialToShoppingItem,
} from '../domain/supermarketSpecials.js'
import {
  shoppingRepository,
  subscribeToShoppingChanges,
} from '../repositories/shoppingRepository.js'
import { supermarketRepository } from '../repositories/supermarketRepository.js'

const props = defineProps({ active: Boolean })
const { t } = useI18n()
const emit = defineEmits(['open-list'])

const PAGE_SIZE = 20
const keyword = ref('')
const category = ref('')
const halfPriceOnly = ref(false)
const sort = ref('discount')
const categories = ref([])
const items = ref([])
const total = ref(0)
const page = ref(0)
const today = ref('')
const syncStatus = ref(null)
const listItems = ref([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const addingIds = ref(new Set())
const loaded = ref(false)

const syncInfo = computed(() => describeSyncStatus(syncStatus.value))
/** 已在清單裡的特價：promotionId → 清單品項，用來把「加入」換成數量控制 */
const inList = computed(
  () =>
    new Map(
      listItems.value.filter((item) => item.promotionId).map((item) => [item.promotionId, item]),
    ),
)
const summary = computed(() => selectionSummary(listItems.value))
const hasMore = computed(() => items.value.length < total.value)
const filtered = computed(() =>
  Boolean(keyword.value.trim() || category.value || halfPriceOnly.value),
)

let requestSeq = 0
let searchTimer

async function load({ append = false } = {}) {
  const seq = ++requestSeq
  const nextPage = append ? page.value + 1 : 0
  if (append) loadingMore.value = true
  else loading.value = true
  error.value = ''
  try {
    const result = await supermarketRepository.specials({
      keyword: keyword.value.trim(),
      category: category.value,
      halfPriceOnly: halfPriceOnly.value,
      sort: sort.value,
      page: nextPage,
      size: PAGE_SIZE,
    })
    if (seq !== requestSeq) return
    items.value = append ? [...items.value, ...result.items] : result.items
    total.value = result.total
    page.value = nextPage
    today.value = result.today
    loaded.value = true
  } catch (failure) {
    if (seq === requestSeq) error.value = localizeMessage(failure.message) || t('specials.loadFailed')
  } finally {
    if (seq === requestSeq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function loadCategories() {
  try {
    categories.value = await supermarketRepository.categories()
  } catch {
    categories.value = []
  }
}

async function loadStatus() {
  try {
    syncStatus.value = await supermarketRepository.status()
  } catch {
    syncStatus.value = null
  }
}

async function loadList() {
  try {
    listItems.value = (await shoppingRepository.active()).items
  } catch {
    // 清單讀不到時仍可瀏覽特價，只是不會顯示已加入的數量
  }
}

function refresh() {
  load()
  loadCategories()
  loadStatus()
  loadList()
}

let unsubscribe
onMounted(() => {
  unsubscribe = subscribeToShoppingChanges(() => {
    if (props.active) loadList()
  })
  if (props.active) refresh()
})
onUnmounted(() => {
  clearTimeout(searchTimer)
  unsubscribe?.()
})
watch(
  () => props.active,
  (active) => {
    if (!active) return
    if (!loaded.value) refresh()
    else loadList()
  },
)
watch(keyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(), 300)
})
watch([category, halfPriceOnly, sort], () => load())

function clearFilters() {
  keyword.value = ''
  category.value = ''
  halfPriceOnly.value = false
}

function markBusy(id, busy) {
  const next = new Set(addingIds.value)
  if (busy) next.add(id)
  else next.delete(id)
  addingIds.value = next
}

async function addToList(special) {
  if (addingIds.value.has(special.id)) return
  markBusy(special.id, true)
  try {
    await shoppingRepository.add(specialToShoppingItem(special, crypto.randomUUID()))
  } catch (failure) {
    showToast(localizeMessage(failure.message) || t('specials.addFailed'))
  } finally {
    markBusy(special.id, false)
  }
}

/** 數量 −／＋；減到 0 時從清單移除（已買過部分的不能減到已買數量以下） */
async function changeQuantity(special, delta) {
  const item = inList.value.get(special.id)
  if (!item || addingIds.value.has(special.id)) return
  const next = item.quantity + delta
  if (next > 999) return
  if (next < Math.max(1, item.purchasedQuantity)) {
    if (item.purchasedQuantity > 0) {
      showToast(t('specials.cannotReduce'))
      return
    }
  }
  markBusy(special.id, true)
  try {
    if (next < 1) await shoppingRepository.remove(item.id)
    else await shoppingRepository.save({ ...item, quantity: next })
  } catch (failure) {
    showToast(localizeMessage(failure.message) || t('shopping.updateFailed'))
  } finally {
    markBusy(special.id, false)
  }
}
</script>

<template>
  <section class="specials" :aria-label="t('specials.sectionAria')">
    <header class="specials-head">
      <span class="specials-brand">Woolworths</span>
      <div class="specials-head__text">
        <strong
          >{{ t('shopping.weeklySpecials') }}<template v-if="syncInfo.period"> · {{ syncInfo.period }}</template></strong
        >
        <small
          >{{ t('specials.regionPrices', { region: syncInfo.region || 'NSW' }) }}<template v-if="syncInfo.updated">
            · {{ syncInfo.updated }}</template
          ></small
        >
      </div>
    </header>
    <p v-if="syncInfo.warning" class="specials-notice is-warning" role="status">
      <van-icon name="warning-o" />
      {{ syncInfo.warning }}
    </p>

    <div class="specials-filters app-page__card">
      <van-search
        v-model="keyword"
        class="specials-search"
        :placeholder="t('specials.searchPlaceholder')"
        maxlength="60"
        shape="round"
        :aria-label="t('specials.searchAria')"
      />
      <div class="specials-chips" role="group" :aria-label="t('specials.filterAria')">
        <button
          type="button"
          class="specials-chip"
          :class="{ 'is-on': halfPriceOnly }"
          :aria-pressed="halfPriceOnly"
          @click="halfPriceOnly = !halfPriceOnly"
        >
          {{ t('specials.halfPriceOnly') }}
        </button>
        <label class="specials-select">
          <span class="sr-only">{{ t('specials.category') }}</span>
          <select v-model="category" :aria-label="t('specials.category')">
            <option value="">{{ t('specials.allCategories') }}</option>
            <option v-for="name in categories" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
        </label>
        <label class="specials-select">
          <span class="sr-only">{{ t('specials.sort') }}</span>
          <select v-model="sort" :aria-label="t('specials.sort')">
            <option v-for="option in SPECIAL_SORTS" :key="option.id" :value="option.id">
              {{ t(`specials.sorts.${option.id}`) }}
            </option>
          </select>
        </label>
      </div>
    </div>

    <div v-if="loading && !items.length" class="specials-state" aria-live="polite">
      <van-loading size="20" /> {{ t('specials.loading') }}
    </div>
    <div v-else-if="error" class="specials-state specials-state--error" role="alert">
      <p>{{ error }}</p>
      <van-button size="small" plain type="primary" @click="refresh">{{ t('common.refresh') }}</van-button>
    </div>
    <div v-else-if="!items.length" class="specials-state">
      <p v-if="filtered">{{ t('specials.noMatches') }}</p>
      <p v-else>{{ t('specials.noData') }}</p>
      <van-button v-if="filtered" size="small" plain type="primary" @click="clearFilters">
        {{ t('specials.clearFilters') }}
      </van-button>
    </div>

    <template v-else>
      <p class="specials-count">{{ t('specials.count', { count: total }) }}</p>
      <ul class="specials-list" :aria-busy="loading">
        <li v-for="special in items" :key="special.id" class="special-card app-page__card">
          <div class="special-card__body">
            <div class="special-card__tags">
              <span v-if="isHalfPrice(special)" class="special-tag special-tag--half">{{ t('specials.promo.HALF_PRICE') }}</span>
              <span v-else class="special-tag">{{
                PROMOTION_TYPE_LABELS[special.promotionType]
                  ? t(`specials.promo.${special.promotionType}`)
                  : t('specials.promo.OTHER')
              }}</span>
              <span v-if="special.category" class="special-card__category">{{
                special.category
              }}</span>
            </div>
            <strong class="special-card__name">{{ special.name }}</strong>
            <span v-if="specialSubtitle(special)" class="special-card__sub">{{
              specialSubtitle(special)
            }}</span>
            <div class="special-card__price">
              <b>{{ formatAud(special.salePriceCents) }}</b>
              <s v-if="special.regularPriceCents">{{ formatAud(special.regularPriceCents) }}</s>
              <span v-if="savingsCents(special)" class="special-card__save"
                >{{ t('specials.save', { amount: formatAud(savingsCents(special)), percent: discountPercent(special) }) }}</span
              >
              <span v-else-if="!special.regularPriceCents" class="special-card__missing"
                >{{ t('specials.noRegularPrice') }}</span
              >
            </div>
            <span v-if="special.unitPriceText" class="special-card__unit">{{
              special.unitPriceText
            }}</span>
            <span class="special-card__end">{{ promotionEndLabel(special, today) }}</span>
          </div>
          <div
            v-if="inList.has(special.id)"
            class="special-qty"
            role="group"
            :aria-label="t('specials.quantityAria', { name: special.name })"
          >
            <button
              type="button"
              :disabled="addingIds.has(special.id)"
              :aria-label="inList.get(special.id).quantity > 1 ? t('specials.decrease') : t('specials.removeFromList')"
              @click="changeQuantity(special, -1)"
            >
              <van-icon :name="inList.get(special.id).quantity > 1 ? 'minus' : 'delete-o'" />
            </button>
            <span aria-live="polite">{{ inList.get(special.id).quantity }}</span>
            <button
              type="button"
              :disabled="addingIds.has(special.id)"
              :aria-label="t('specials.increase')"
              @click="changeQuantity(special, 1)"
            >
              <van-icon name="plus" />
            </button>
          </div>
          <van-button
            v-else
            class="special-card__add"
            type="primary"
            size="small"
            icon="plus"
            :loading="addingIds.has(special.id)"
            :disabled="addingIds.has(special.id)"
            :aria-label="t('specials.addAria', { name: special.name })"
            @click="addToList(special)"
            >{{ t('specials.add') }}</van-button
          >
        </li>
      </ul>
      <van-button
        v-if="hasMore"
        class="specials-more"
        block
        plain
        type="primary"
        :loading="loadingMore"
        @click="load({ append: true })"
        >{{ t('specials.loadMore') }}</van-button
      >
      <p class="specials-disclaimer">
        {{ t('specials.disclaimer', { region: syncInfo.region || 'NSW' }) }}
      </p>
    </template>

    <div v-if="summary.count" class="specials-cart" role="region" :aria-label="t('specials.selectedAria')">
      <div>
        <span>{{ t('specials.selectedCount', { count: summary.count }) }}</span>
        <strong>{{ t('shopping.estimateLine', { amount: formatAud(summary.estimatedCents) }) }}</strong>
      </div>
      <van-button type="primary" size="small" @click="emit('open-list')">{{ t('specials.viewList') }}</van-button>
    </div>
  </section>
</template>

<style scoped>
.specials {
  display: grid;
  gap: 10px;
}
.specials-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.specials-brand {
  flex: none;
  padding: 4px 8px;
  border-radius: 8px;
  background: #1a7f37;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
}
.specials-head__text {
  display: grid;
  min-width: 0;
}
.specials-head__text strong {
  color: var(--color-text);
  font-size: 15px;
}
.specials-head__text small {
  color: var(--color-muted);
  font-size: 12px;
}
.special-qty {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: #eaf2fd;
}
.special-qty button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: #fff;
  color: var(--color-primary);
}
.special-qty span {
  min-width: 22px;
  color: var(--color-primary);
  font-weight: 800;
  text-align: center;
}
.specials-cart {
  position: sticky;
  bottom: calc(var(--van-tabbar-height, 50px) + env(safe-area-inset-bottom, 0px) + 8px);
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 4px 14px rgb(15 40 80 / 10%);
}
.specials-cart div {
  display: grid;
}
.specials-cart span {
  color: var(--color-muted);
  font-size: 12px;
}
.specials-cart strong {
  color: var(--color-text);
  font-size: 17px;
}
.specials-cart :deep(.van-button) {
  min-height: 40px;
  border-radius: 10px;
}
.specials-filters {
  display: grid;
  gap: 8px;
  padding: 8px 10px 10px;
}
.specials-search {
  padding: 0;
}
.specials-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.specials-chip,
.specials-select select {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: #fff;
  color: #3c4f66;
  font-size: 13px;
  font-weight: 700;
}
.specials-chip.is-on {
  border-color: var(--color-primary);
  background: #eaf2fd;
  color: var(--color-primary);
}
.specials-select select {
  max-width: 160px;
  appearance: none;
  padding-right: 12px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.specials-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 2px;
  color: var(--color-muted);
  font-size: 12px;
}
.specials-notice.is-warning {
  color: #9a6a12;
}
.specials-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 32px 12px;
  color: var(--color-muted);
  font-size: 14px;
  text-align: center;
}
.specials-state p {
  margin: 0;
}
.specials-state--error {
  color: var(--color-expense);
}
.specials-count {
  margin: 0 2px;
  color: var(--color-muted);
  font-size: 12px;
}
.specials-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.special-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
}
.special-card__body {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}
.special-card__tags {
  display: flex;
  align-items: center;
  gap: 6px;
}
.special-tag {
  padding: 1px 7px;
  border-radius: 6px;
  background: #eaf2fd;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 800;
}
.special-tag--half {
  background: #fdecec;
  color: #c43a3a;
}
.special-card__category {
  overflow: hidden;
  color: var(--color-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.special-card__name {
  overflow-wrap: anywhere;
  color: var(--color-text);
  font-size: 15px;
  line-height: 1.35;
}
.special-card__sub,
.special-card__unit,
.special-card__end {
  color: var(--color-muted);
  font-size: 12px;
}
.special-card__price {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}
.special-card__price b {
  color: #c43a3a;
  font-size: 18px;
}
.special-card__price s {
  color: var(--color-muted);
  font-size: 13px;
}
.special-card__save {
  color: #1d7a46;
  font-size: 12px;
  font-weight: 700;
}
.special-card__missing {
  color: var(--color-muted);
  font-size: 12px;
}
.special-card__add {
  flex: none;
  min-width: 72px;
  min-height: 40px;
  border-radius: 10px;
}
.specials-more {
  min-height: 44px;
  border-radius: 12px;
}
.specials-disclaimer {
  margin: 4px 2px 0;
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.5;
}
</style>

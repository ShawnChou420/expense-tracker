<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { showToast } from 'vant'
import { formatAud } from '../domain/money.js'
import {
  describeLastImport,
  discountPercent,
  isHalfPrice,
  PROMOTION_TYPE_LABELS,
  promotionEndLabel,
  savingsCents,
  SPECIAL_SORTS,
  specialSubtitle,
  specialToShoppingItem,
} from '../domain/supermarketSpecials.js'
import { shoppingRepository } from '../repositories/shoppingRepository.js'
import { supermarketRepository } from '../repositories/supermarketRepository.js'

const props = defineProps({ active: Boolean })
const emit = defineEmits(['added'])

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
const lastImport = ref(undefined)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const addingIds = ref(new Set())
const loaded = ref(false)

const importNotice = computed(() =>
  lastImport.value === undefined ? null : describeLastImport(lastImport.value),
)
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
    lastImport.value = result.lastImport
    loaded.value = true
  } catch (failure) {
    if (seq === requestSeq) error.value = failure.message || '無法讀取本週特價'
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

function refresh() {
  load()
  loadCategories()
}

onMounted(() => {
  if (props.active) refresh()
})
onUnmounted(() => clearTimeout(searchTimer))
watch(
  () => props.active,
  (active) => {
    if (active && !loaded.value) refresh()
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

async function addToList(special) {
  if (addingIds.value.has(special.id)) return
  addingIds.value = new Set([...addingIds.value, special.id])
  try {
    const { item, merged } = await shoppingRepository.add(
      specialToShoppingItem(special, crypto.randomUUID()),
    )
    showToast(merged ? `已在清單中，數量改為 ${item.quantity}` : '已加入我的清單')
    emit('added')
  } catch (failure) {
    showToast(failure.message || '加入失敗')
  } finally {
    const next = new Set(addingIds.value)
    next.delete(special.id)
    addingIds.value = next
  }
}
</script>

<template>
  <section class="specials" aria-label="Woolworths 本週特價">
    <div class="specials-filters app-page__card">
      <van-search
        v-model="keyword"
        class="specials-search"
        placeholder="搜尋商品或品牌"
        maxlength="60"
        shape="round"
        aria-label="搜尋特價商品"
      />
      <div class="specials-chips" role="group" aria-label="篩選">
        <button
          type="button"
          class="specials-chip"
          :class="{ 'is-on': halfPriceOnly }"
          :aria-pressed="halfPriceOnly"
          @click="halfPriceOnly = !halfPriceOnly"
        >
          只看半價
        </button>
        <label class="specials-select">
          <span class="sr-only">分類</span>
          <select v-model="category" aria-label="分類">
            <option value="">全部分類</option>
            <option v-for="name in categories" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
        </label>
        <label class="specials-select">
          <span class="sr-only">排序</span>
          <select v-model="sort" aria-label="排序">
            <option v-for="option in SPECIAL_SORTS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>
    </div>

    <p
      v-if="importNotice"
      class="specials-notice"
      :class="{ 'is-warning': importNotice.warning }"
      role="status"
    >
      <van-icon :name="importNotice.warning ? 'warning-o' : 'clock-o'" />
      {{ importNotice.text }}
    </p>

    <div v-if="loading && !items.length" class="specials-state" aria-live="polite">
      <van-loading size="20" /> 正在讀取本週特價…
    </div>
    <div v-else-if="error" class="specials-state specials-state--error" role="alert">
      <p>{{ error }}</p>
      <van-button size="small" plain type="primary" @click="refresh">重新整理</van-button>
    </div>
    <div v-else-if="!items.length" class="specials-state">
      <p v-if="filtered">找不到符合條件的特價商品。</p>
      <p v-else>本週還沒有特價資料。</p>
      <van-button v-if="filtered" size="small" plain type="primary" @click="clearFilters">
        清除篩選
      </van-button>
    </div>

    <template v-else>
      <p class="specials-count">共 {{ total }} 項特價 · Woolworths（NSW）</p>
      <ul class="specials-list" :aria-busy="loading">
        <li v-for="special in items" :key="special.id" class="special-card app-page__card">
          <div class="special-card__body">
            <div class="special-card__tags">
              <span v-if="isHalfPrice(special)" class="special-tag special-tag--half">半價</span>
              <span v-else class="special-tag">{{
                PROMOTION_TYPE_LABELS[special.promotionType] || '特價'
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
                >省 {{ formatAud(savingsCents(special)) }}（{{ discountPercent(special) }}%）</span
              >
              <span v-else-if="!special.regularPriceCents" class="special-card__missing"
                >原價未提供</span
              >
            </div>
            <span v-if="special.unitPriceText" class="special-card__unit">{{
              special.unitPriceText
            }}</span>
            <span class="special-card__end">{{ promotionEndLabel(special, today) }}</span>
          </div>
          <van-button
            class="special-card__add"
            type="primary"
            size="small"
            icon="plus"
            :loading="addingIds.has(special.id)"
            :disabled="addingIds.has(special.id)"
            :aria-label="`把 ${special.name} 加入我的清單`"
            @click="addToList(special)"
            >加入</van-button
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
        >載入更多</van-button
      >
      <p class="specials-disclaimer">
        價格以門市與 Woolworths 官網為準，可能依地區不同。資料為手動整理匯入，非即時價格。
      </p>
    </template>
  </section>
</template>

<style scoped>
.specials {
  display: grid;
  gap: 10px;
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

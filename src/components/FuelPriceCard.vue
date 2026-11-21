<script setup>
// 首頁「附近油價」：NSW FuelCheck 最便宜的 3 家加油站。
// 位置用郵遞區號或這台裝置的目前位置（只用來查詢，不儲存座標）；偏好存在這台裝置。
import { computed, onMounted, ref } from 'vue'
import { fuelRepository } from '../repositories/fuelRepository.js'
import {
  FUEL_TYPE_OPTIONS,
  describeFuelFreshness,
  formatFuelPrice,
  getCheapestGap,
  isValidPostcode,
  normalizeFuelPrefs,
} from '../domain/fuel.js'
import { useI18n } from 'vue-i18n'
import { localizeMessage } from '../i18n/messages.js'

const { t } = useI18n()

const props = defineProps({
  now: { type: Date, required: true },
})

const prefs = ref(normalizeFuelPrefs(fuelRepository.loadPrefs()))
const editing = ref(!hasLocation(prefs.value))
const postcodeDraft = ref(prefs.value.postcode)
const loading = ref(false)
const error = ref('')
const result = ref(null)
const locating = ref(false)

const stations = computed(() => result.value?.stations ?? [])
const gap = computed(() => getCheapestGap(stations.value))
const freshness = computed(() => {
  const text = describeFuelFreshness(result.value?.fetchedAt, props.now)
  if (!text) return ''
  const minutes = /^(\d+) 分鐘前更新$/.exec(text)
  const hours = /^(\d+) 小時前更新$/.exec(text)
  if (minutes) return t('fuel.minutesAgo', { minutes: minutes[1] })
  if (hours) return t('fuel.hoursAgo', { hours: hours[1] })
  return t('fuel.justUpdated')
})
const locationLabel = computed(() =>
  prefs.value.mode === 'GPS' ? t('fuel.nearby5km') : t('fuel.postcodeLabel', { postcode: prefs.value.postcode }),
)

function hasLocation(/** @type {ReturnType<typeof normalizeFuelPrefs>} */ value) {
  return value.mode === 'GPS' || isValidPostcode(value.postcode)
}

function savePrefs(next) {
  prefs.value = next
  fuelRepository.savePrefs(next)
}

/** @returns {Promise<{ latitude: number, longitude: number }>} */
function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error(t('fuel.noGeolocation')))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => reject(new Error(t('fuel.permissionDenied'))),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    )
  })
}

let loadSeq = 0
async function load() {
  if (!hasLocation(prefs.value)) return
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  try {
    const query =
      prefs.value.mode === 'GPS'
        ? { fuelType: prefs.value.fuelType, ...(await currentPosition()) }
        : { fuelType: prefs.value.fuelType, postcode: prefs.value.postcode }
    const data = await fuelRepository.nearby(query)
    if (seq === loadSeq) result.value = data
  } catch (failure) {
    if (seq === loadSeq) {
      result.value = null
      // 位置權限錯誤要告訴使用者改用郵遞區號；其他（伺服器、網路）只說暫時取不到，不顯示狀態碼
      const message = failure instanceof Error ? localizeMessage(failure.message) : ''
      error.value = message === t('fuel.permissionDenied') ? message : t('fuel.unavailable')
    }
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function chooseFuel(/** @type {string} */ fuelType) {
  if (fuelType === prefs.value.fuelType) return
  savePrefs({ ...prefs.value, fuelType })
  load()
}

function usePostcode() {
  if (!isValidPostcode(postcodeDraft.value.trim())) {
    error.value = t('fuel.postcodeInvalid')
    return
  }
  savePrefs({ ...prefs.value, mode: 'POSTCODE', postcode: postcodeDraft.value.trim() })
  editing.value = false
  load()
}

async function useCurrentLocation() {
  locating.value = true
  error.value = ''
  try {
    await currentPosition()
    savePrefs({ ...prefs.value, mode: 'GPS' })
    editing.value = false
    load()
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : t('fuel.locationFailed')
  } finally {
    locating.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="fuel-card app-page__card" aria-labelledby="fuel-card-title">
    <div class="fuel-card__head">
      <span class="fuel-card__icon" aria-hidden="true"><van-icon name="logistics" /></span>
      <div class="fuel-card__titles">
        <h2 id="fuel-card-title">{{ t('fuel.title') }}</h2>
        <p v-if="!editing">{{ locationLabel }}<template v-if="freshness"> · {{ freshness }}</template></p>
        <p v-else>{{ t('fuel.subtitle') }}</p>
      </div>
      <button
        v-if="!editing"
        type="button"
        class="fuel-card__edit"
        :aria-label="t('fuel.changeLocation')"
        @click="editing = true"
      >
        <van-icon name="location-o" aria-hidden="true" />
      </button>
    </div>

    <div class="fuel-card__fuels" role="radiogroup" :aria-label="t('fuel.fuelType')">
      <button
        v-for="option in FUEL_TYPE_OPTIONS"
        :key="option.id"
        type="button"
        role="radio"
        class="fuel-card__fuel"
        :class="{ 'is-active': prefs.fuelType === option.id }"
        :aria-checked="prefs.fuelType === option.id"
        @click="chooseFuel(option.id)"
      >
        {{ option.id === 'DL' ? t('fuel.diesel') : option.label }}
      </button>
    </div>

    <form v-if="editing" class="fuel-card__setup" @submit.prevent="usePostcode">
      <input
        v-model="postcodeDraft"
        type="text"
        inputmode="numeric"
        maxlength="4"
        :placeholder="t('fuel.postcodeHint')"
        :aria-label="t('fuel.postcode')"
      />
      <van-button native-type="submit" size="small" type="primary">{{ t('fuel.searchShort') }}</van-button>
      <van-button
        size="small"
        plain
        type="primary"
        icon="aim"
        :loading="locating"
        @click="useCurrentLocation"
      >
        {{ t('fuel.useMyLocation') }}
      </van-button>
    </form>

    <p v-if="error" class="fuel-card__error" role="alert">{{ error }}</p>

    <template v-if="!editing && !error">
      <van-skeleton v-if="loading && !result" :row="3" />
      <p v-else-if="result && stations.length === 0" class="fuel-card__empty">
        {{ t('fuel.noPricesNearby') }}
      </p>
      <ol v-else-if="stations.length" class="fuel-card__list">
        <li v-for="(station, index) in stations" :key="`${station.name}-${station.address}`">
          <span class="fuel-card__rank" :class="{ 'is-best': index === 0 }">{{ index + 1 }}</span>
          <span class="fuel-card__station">
            <strong>{{ station.name }}</strong>
            <small>
              <template v-if="station.distanceKm !== null">{{ station.distanceKm }} km · </template>
              {{ station.address }}
            </small>
          </span>
          <span class="fuel-card__price">
            <strong>{{ formatFuelPrice(station.priceTenths) }}</strong>
            <small>¢/L</small>
          </span>
        </li>
      </ol>
      <p v-if="gap" class="fuel-card__hint">{{ t('fuel.cheaperBy', { gap }) }}</p>
      <p v-if="result?.stale" class="fuel-card__hint">{{ t('fuel.stale') }}</p>
    </template>

    <p class="fuel-card__source">{{ t('fuel.source') }}</p>
  </section>
</template>

<style scoped>
.fuel-card {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  padding: 16px;
}
.fuel-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.fuel-card__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 20px;
}
.fuel-card__titles {
  flex: 1;
  min-width: 0;
}
.fuel-card__titles h2 {
  margin: 0;
  color: var(--color-heading);
  font-size: var(--font-section);
}
.fuel-card__titles p {
  margin: 2px 0 0;
  color: var(--color-muted);
  font-size: var(--font-caption);
}
.fuel-card__edit {
  display: grid;
  place-items: center;
  width: var(--touch-target);
  height: var(--touch-target);
  border: 0;
  border-radius: 12px;
  background: none;
  color: var(--color-primary);
  font-size: 20px;
}
.fuel-card__fuels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fuel-card__fuel {
  min-width: 52px;
  min-height: var(--touch-target);
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-heading);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.fuel-card__fuel.is-active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.fuel-card__setup {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.fuel-card__setup input {
  flex: 1 1 140px;
  min-width: 0;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  font: inherit;
  font-size: 15px;
}
.fuel-card__error {
  margin: 0;
  color: var(--color-danger);
  font-size: 13px;
}
.fuel-card__empty,
.fuel-card__hint,
.fuel-card__source {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
}
.fuel-card__source {
  font-size: var(--font-caption);
}
.fuel-card__list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.fuel-card__list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}
.fuel-card__list li:last-child {
  border-bottom: 0;
}
.fuel-card__rank {
  display: grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--color-background);
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 800;
}
.fuel-card__rank.is-best {
  background: var(--color-income-soft);
  color: var(--color-income);
}
.fuel-card__station {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.fuel-card__station strong {
  color: var(--color-heading);
  font-size: 15px;
  overflow-wrap: anywhere;
}
.fuel-card__station small {
  color: var(--color-muted);
  font-size: var(--font-caption);
  overflow-wrap: anywhere;
}
.fuel-card__price {
  display: grid;
  flex: none;
  justify-items: end;
}
.fuel-card__price strong {
  color: var(--color-heading);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
.fuel-card__price small {
  color: var(--color-muted);
  font-size: var(--font-caption);
}
</style>

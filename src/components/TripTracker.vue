<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { formatLocalDate, getWeekRange, parseLocalDate } from '../domain/date.js'
import { dollarsToCents, formatAud, formatCentsInput } from '../domain/money.js'
import { getTripStats } from '../domain/tripStats.js'
import { createPassenger, createTrip, getPassengerDefaultFareCents } from '../domain/trips.js'
import {
  createInMemoryPassengerRepository,
  createInMemoryTripRepository,
} from '../repositories/inMemoryTripRepositories.js'
import { getTodayDate } from '../utils/time.js'

const passengerRepository = createInMemoryPassengerRepository()
const tripRepository = createInMemoryTripRepository()
const passengers = ref([])
const trips = ref([])
const selectedWeekDate = ref(getTodayDate())
const showPassengerForm = ref(false)
const showTripForm = ref(false)
const showPassengerManager = ref(false)
const editingPassengerId = ref(null)
const editingTripId = ref(null)

const passengerForm = ref({ name: '', oneWay: '', roundTrip: '', active: true })
const tripForm = ref({ date: getTodayDate(), type: 'WORK', tripMode: 'ONE_WAY', note: '' })
const selectedPassengerIds = ref([])
const chargeForms = ref([])

const activePassengers = computed(() => passengers.value.filter((passenger) => passenger.active))
const weekRange = computed(() => getWeekRange(selectedWeekDate.value))
const weeklyTrips = computed(() =>
  trips.value
    .filter((trip) => trip.date >= weekRange.value.start && trip.date <= weekRange.value.end)
    .sort((a, b) => b.date.localeCompare(a.date)),
)
const stats = computed(() =>
  getTripStats({
    trips: trips.value,
    passengers: passengers.value,
    referenceDate: selectedWeekDate.value,
  }),
)

const typeLabel = { WORK: '上班', LEISURE: '出遊', OTHER: '其他' }
const modeLabel = { ONE_WAY: '單程', ROUND_TRIP: '來回', CUSTOM: '自訂' }
const weekLabel = computed(() => {
  if (!weekRange.value) return '選擇日期'
  return `${weekRange.value.start.slice(5)} – ${weekRange.value.end.slice(5)}`
})

function moveWeek(direction) {
  const date = parseLocalDate(selectedWeekDate.value)
  if (!date) return
  date.setDate(date.getDate() + direction * 7)
  selectedWeekDate.value = formatLocalDate(date)
}

function selectCurrentWeek() {
  selectedWeekDate.value = getTodayDate()
}

function startNewTrip() {
  if (activePassengers.value.length === 0) {
    showPassengerManager.value = true
    openPassengerForm()
    return
  }
  openTripForm()
}

async function refreshData() {
  passengers.value = await passengerRepository.list()
  trips.value = await tripRepository.list()
}

function resetPassengerForm() {
  editingPassengerId.value = null
  passengerForm.value = { name: '', oneWay: '', roundTrip: '', active: true }
}

function openPassengerForm(passenger) {
  if (passenger) {
    editingPassengerId.value = passenger.id
    passengerForm.value = {
      name: passenger.name,
      oneWay:
        passenger.defaultOneWayFareCents === null
          ? ''
          : formatCentsInput(passenger.defaultOneWayFareCents),
      roundTrip:
        passenger.defaultRoundTripFareCents === null
          ? ''
          : formatCentsInput(passenger.defaultRoundTripFareCents),
      active: passenger.active,
    }
  } else {
    resetPassengerForm()
  }
  showPassengerForm.value = true
}

async function savePassenger() {
  const name = passengerForm.value.name.trim()
  const oneWay = dollarsToCents(passengerForm.value.oneWay)
  const roundTrip = dollarsToCents(passengerForm.value.roundTrip)
  if (
    !name ||
    (passengerForm.value.oneWay !== '' && oneWay === null) ||
    (passengerForm.value.roundTrip !== '' && roundTrip === null)
  ) {
    showToast('請輸入名稱與有效的非負車資')
    return
  }

  const existing = passengers.value.find((passenger) => passenger.id === editingPassengerId.value)
  await passengerRepository.save(
    createPassenger({
      ...existing,
      id: editingPassengerId.value || undefined,
      name,
      active: passengerForm.value.active,
      defaultOneWayFareCents: oneWay,
      defaultRoundTripFareCents: roundTrip,
    }),
  )
  await refreshData()
  showPassengerForm.value = false
  resetPassengerForm()
  showToast('乘客已儲存')
}

function resetTripForm() {
  editingTripId.value = null
  tripForm.value = { date: getTodayDate(), type: 'WORK', tripMode: 'ONE_WAY', note: '' }
  selectedPassengerIds.value = []
  chargeForms.value = []
}

function openTripForm(trip) {
  if (trip) {
    editingTripId.value = trip.id
    tripForm.value = {
      date: trip.date,
      type: trip.type,
      tripMode: trip.tripMode,
      note: trip.note || '',
    }
    selectedPassengerIds.value = trip.charges.map((charge) => charge.passengerId)
    chargeForms.value = trip.charges.map((charge) => ({
      passengerId: charge.passengerId,
      amount: formatCentsInput(charge.amountCents),
      paymentStatus: charge.paymentStatus,
      paidAt: charge.paidAt || '',
    }))
  } else {
    resetTripForm()
    tripForm.value.date = selectedWeekDate.value
  }
  showTripForm.value = true
}

function refreshChargeForms(useDefaults = true) {
  chargeForms.value = selectedPassengerIds.value.map((passengerId) => {
    const existing = chargeForms.value.find((charge) => charge.passengerId === passengerId)
    if (existing) return existing
    const passenger = passengers.value.find((item) => item.id === passengerId)
    return {
      passengerId,
      amount: formatCentsInput(
        useDefaults ? getPassengerDefaultFareCents(passenger, tripForm.value.tripMode) : 0,
      ),
      paymentStatus: 'PENDING',
      paidAt: '',
    }
  })
}

watch(selectedPassengerIds, () => refreshChargeForms(), { deep: true })
watch(
  () => tripForm.value.tripMode,
  () => {
    if (editingTripId.value) return
    chargeForms.value = chargeForms.value.map((charge) => {
      const passenger = passengers.value.find((item) => item.id === charge.passengerId)
      return {
        ...charge,
        amount: formatCentsInput(getPassengerDefaultFareCents(passenger, tripForm.value.tripMode)),
      }
    })
  },
)

async function saveTrip() {
  if (!tripForm.value.date || selectedPassengerIds.value.length === 0) {
    showToast('請選擇日期與至少一位乘客')
    return
  }
  const charges = chargeForms.value.map((charge) => ({
    passengerId: charge.passengerId,
    amountCents: dollarsToCents(charge.amount),
    paymentStatus: charge.paymentStatus,
    paidAt: charge.paymentStatus === 'PAID' ? charge.paidAt || tripForm.value.date : undefined,
  }))
  if (charges.some((charge) => charge.amountCents === null)) {
    showToast('每位乘客都需要有效的非負金額')
    return
  }
  const existing = trips.value.find((trip) => trip.id === editingTripId.value)
  await tripRepository.save(
    createTrip({ ...existing, id: editingTripId.value || undefined, ...tripForm.value, charges }),
  )
  await refreshData()
  showTripForm.value = false
  resetTripForm()
  showToast('車資行程已儲存')
}

async function removeTrip(trip) {
  try {
    await showConfirmDialog({
      title: '刪除這筆車資行程？',
      message: `${trip.date} 的紀錄將無法復原。`,
    })
    await tripRepository.remove(trip.id)
    await refreshData()
    showToast('已刪除車資行程')
  } catch {
    // The user cancelled the confirmation dialog.
  }
}

function getPassengerName(passengerId) {
  return passengers.value.find((passenger) => passenger.id === passengerId)?.name || '已停用乘客'
}

function getTripTotalCents(trip) {
  return trip.charges.reduce((total, charge) => total + charge.amountCents, 0)
}

onMounted(refreshData)
</script>

<template>
  <section class="trip-page">
    <header class="trip-page__header">
      <div>
        <p class="eyebrow">TRIP LEDGER</p>
        <h1>車資紀錄</h1>
        <p>每趟記清楚，收款不漏掉。</p>
      </div>
      <van-icon name="logistics" class="header-icon" aria-hidden="true" />
    </header>

    <p class="memory-notice" role="status">
      <van-icon name="info-o" /> 暫存模式：資料只存在記憶體，關閉或重新啟動 App 後會消失。
    </p>

    <section class="overview" aria-labelledby="overview-title">
      <div class="overview__top">
        <div>
          <p class="eyebrow">THIS WEEK</p>
          <h2 id="overview-title">本週車資</h2>
        </div>
        <button class="today-link" type="button" @click="selectCurrentWeek">回本週</button>
      </div>
      <div class="week-switcher" aria-label="切換統計週期">
        <button type="button" aria-label="上一週" @click="moveWeek(-1)">
          <van-icon name="arrow-left" />
        </button>
        <div class="week-switcher__label">
          <strong>{{ weekLabel }}</strong>
          <span>週一至週日</span>
        </div>
        <button type="button" aria-label="下一週" @click="moveWeek(1)">
          <van-icon name="arrow" />
        </button>
      </div>
      <div class="overview__hero">
        <span>本週應收</span>
        <strong>{{ formatAud(stats.receivableCents) }}</strong>
        <small>全部行程的約定車資</small>
      </div>
      <div class="summary-grid">
        <div class="summary-stat summary-stat--paid">
          <span class="stat-dot" aria-hidden="true"></span>
          <div>
            <span>已收</span><strong>{{ formatAud(stats.paidCents) }}</strong>
          </div>
        </div>
        <div class="summary-stat summary-stat--pending">
          <span class="stat-dot" aria-hidden="true"></span>
          <div>
            <span>待收</span><strong>{{ formatAud(stats.pendingCents) }}</strong>
          </div>
        </div>
      </div>
    </section>

    <van-button class="new-trip-button" type="primary" block icon="plus" @click="startNewTrip">
      {{ activePassengers.length ? '新增車資行程' : '新增乘客，開始記錄' }}
    </van-button>

    <section class="trip-section" aria-labelledby="trips-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">ACTIVITY</p>
          <h2 id="trips-title">
            本週行程 <span class="section-count">{{ weeklyTrips.length }}</span>
          </h2>
        </div>
      </div>
      <div v-if="weeklyTrips.length === 0" class="empty-card">
        <van-icon name="records" class="empty-card__icon" />
        <strong>這週還沒有行程</strong>
        <span>{{
          activePassengers.length
            ? '按上方「新增車資行程」開始記錄。'
            : '先新增常用乘客，就能開始記錄。'
        }}</span>
      </div>
      <article v-for="trip in weeklyTrips" :key="trip.id" class="trip-card">
        <div class="trip-card__top">
          <div>
            <span class="trip-card__date">{{ trip.date }}</span>
            <div class="trip-card__meta">
              {{ typeLabel[trip.type] }} · {{ modeLabel[trip.tripMode] }} ·
              {{ trip.charges.length }} 位乘客
            </div>
          </div>
          <strong class="trip-card__amount">{{ formatAud(getTripTotalCents(trip)) }}</strong>
        </div>
        <div class="trip-card__charges">
          <div v-for="charge in trip.charges" :key="charge.passengerId" class="charge-row">
            <span class="charge-row__name">{{ getPassengerName(charge.passengerId) }}</span>
            <span class="charge-row__amount">{{ formatAud(charge.amountCents) }}</span>
            <span
              :class="[
                'status-pill',
                charge.paymentStatus === 'PAID' ? 'status-pill--paid' : 'status-pill--pending',
              ]"
            >
              {{ charge.paymentStatus === 'PAID' ? '已收' : '待收' }}
            </span>
          </div>
        </div>
        <p v-if="trip.note" class="trip-card__note">備註：{{ trip.note }}</p>
        <div class="trip-card__actions">
          <button type="button" @click="openTripForm(trip)">
            <van-icon name="edit" /> 編輯行程
          </button>
          <button type="button" class="trip-card__delete" @click="removeTrip(trip)">刪除</button>
        </div>
      </article>
    </section>

    <section
      v-if="stats.outstandingByPassenger.length"
      class="trip-section"
      aria-labelledby="pending-title"
    >
      <div class="section-heading">
        <div>
          <p class="eyebrow">TO COLLECT</p>
          <h2 id="pending-title">待收款項</h2>
        </div>
      </div>
      <div class="pending-list">
        <div
          v-for="summary in stats.outstandingByPassenger"
          :key="summary.passengerId"
          class="pending-list__row"
        >
          <span>{{ summary.passengerName }}</span>
          <strong>{{ formatAud(summary.pendingCents) }}</strong>
        </div>
      </div>
    </section>

    <section class="trip-section people-section" aria-labelledby="people-title">
      <button
        class="people-toggle"
        type="button"
        :aria-expanded="showPassengerManager"
        @click="showPassengerManager = !showPassengerManager"
      >
        <span class="people-toggle__icon"><van-icon name="friends-o" /></span>
        <span class="people-toggle__text"
          ><strong id="people-title">常用乘客</strong
          ><small>{{ activePassengers.length }} 位使用中 · 管理名稱與預設車資</small></span
        >
        <van-icon :name="showPassengerManager ? 'arrow-up' : 'arrow-down'" />
      </button>
      <div v-if="showPassengerManager" class="people-content">
        <van-button
          class="add-person-button"
          block
          plain
          type="primary"
          icon="plus"
          @click="openPassengerForm()"
          >新增乘客</van-button
        >
        <div v-if="passengers.length === 0" class="people-empty">
          新增第一位乘客後，就能記錄車資行程。
        </div>
        <button
          v-for="passenger in passengers"
          :key="passenger.id"
          class="person-row"
          type="button"
          @click="openPassengerForm(passenger)"
        >
          <span class="person-row__avatar">{{ passenger.name.slice(0, 1).toUpperCase() }}</span>
          <span class="person-row__body"
            ><strong>{{ passenger.name }}</strong
            ><small>{{
              passenger.active
                ? `單程 ${formatAud(passenger.defaultOneWayFareCents || 0)} · 來回 ${formatAud(passenger.defaultRoundTripFareCents || 0)}`
                : '已停用 · 歷史行程仍保留'
            }}</small></span
          >
          <van-icon name="arrow" />
        </button>
      </div>
    </section>

    <section
      v-if="stats.passengerSummaries.length"
      class="trip-section"
      aria-labelledby="passenger-stats-title"
    >
      <div class="section-heading">
        <div>
          <p class="eyebrow">OVERVIEW</p>
          <h2 id="passenger-stats-title">乘客統計</h2>
        </div>
      </div>
      <div class="passenger-stats">
        <div
          v-for="summary in stats.passengerSummaries"
          :key="summary.passengerId"
          class="passenger-stats__row"
        >
          <span
            ><strong>{{ summary.passengerName }}</strong
            ><small>{{ summary.tripCount }} 趟</small></span
          >
          <span>{{ formatAud(summary.totalCents) }}</span>
        </div>
      </div>
    </section>

    <van-popup v-model:show="showPassengerForm" position="bottom" round safe-area-inset-bottom>
      <form class="sheet-form" @submit.prevent="savePassenger">
        <div class="sheet-header">
          <div>
            <p class="eyebrow">PASSENGER</p>
            <h2>{{ editingPassengerId ? '編輯乘客' : '新增乘客' }}</h2>
          </div>
          <button type="button" aria-label="關閉" @click="showPassengerForm = false">
            <van-icon name="cross" />
          </button>
        </div>
        <div class="sheet-scroll">
          <p class="sheet-note">設定常用車資後，新增行程時會自動帶入，仍可逐筆調整。</p>
          <van-cell-group inset>
            <van-field
              v-model="passengerForm.name"
              label="乘客名稱"
              placeholder="例如 Kim"
              required
              clearable
            />
            <van-field
              v-model="passengerForm.oneWay"
              label="單程 AUD"
              type="number"
              inputmode="decimal"
              placeholder="0.00"
            />
            <van-field
              v-model="passengerForm.roundTrip"
              label="來回 AUD"
              type="number"
              inputmode="decimal"
              placeholder="0.00"
            />
            <van-cell v-if="editingPassengerId" title="使用中" label="停用後不會出現在新行程選擇中"
              ><template #right-icon
                ><van-switch v-model="passengerForm.active" size="22" /></template
            ></van-cell>
          </van-cell-group>
        </div>
        <div class="sheet-footer">
          <van-button block type="primary" native-type="submit">儲存乘客</van-button>
        </div>
      </form>
    </van-popup>

    <van-popup v-model:show="showTripForm" position="bottom" round safe-area-inset-bottom>
      <form class="sheet-form" @submit.prevent="saveTrip">
        <div class="sheet-header">
          <div>
            <p class="eyebrow">TRIP</p>
            <h2>{{ editingTripId ? '編輯行程' : '新增車資行程' }}</h2>
          </div>
          <button type="button" aria-label="關閉" @click="showTripForm = false">
            <van-icon name="cross" />
          </button>
        </div>
        <div class="sheet-scroll">
          <div class="form-step">
            <span class="step-number">1</span>
            <h3>行程資訊</h3>
          </div>
          <van-cell-group inset
            ><van-field v-model="tripForm.date" label="日期" type="date" required
          /></van-cell-group>
          <p class="field-label">行程類型</p>
          <van-radio-group v-model="tripForm.type" class="choice-grid"
            ><van-radio name="WORK">上班</van-radio><van-radio name="LEISURE">出遊</van-radio
            ><van-radio name="OTHER">其他</van-radio></van-radio-group
          >
          <p class="field-label">行程方式</p>
          <van-radio-group v-model="tripForm.tripMode" class="choice-grid"
            ><van-radio name="ONE_WAY">單程</van-radio><van-radio name="ROUND_TRIP">來回</van-radio
            ><van-radio name="CUSTOM">自訂</van-radio></van-radio-group
          >

          <div class="form-step">
            <span class="step-number">2</span>
            <h3>選擇乘客</h3>
            <small>{{ selectedPassengerIds.length }} 位已選</small>
          </div>
          <div v-if="activePassengers.length === 0" class="form-hint">
            還沒有使用中的乘客。請先到「常用乘客」新增。
          </div>
          <van-checkbox-group v-else v-model="selectedPassengerIds" class="person-choices"
            ><van-checkbox
              v-for="passenger in activePassengers"
              :key="passenger.id"
              :name="passenger.id"
              >{{ passenger.name }}</van-checkbox
            ></van-checkbox-group
          >

          <template v-if="chargeForms.length">
            <div class="form-step">
              <span class="step-number">3</span>
              <h3>金額與收款</h3>
            </div>
            <div class="charge-editor">
              <div
                v-for="charge in chargeForms"
                :key="charge.passengerId"
                class="charge-editor__row"
              >
                <strong>{{ getPassengerName(charge.passengerId) }}</strong>
                <van-field
                  v-model="charge.amount"
                  type="number"
                  inputmode="decimal"
                  label="AUD $"
                  placeholder="0.00"
                />
                <van-radio-group v-model="charge.paymentStatus" class="payment-choices"
                  ><van-radio name="PENDING">待收</van-radio
                  ><van-radio name="PAID">已收</van-radio></van-radio-group
                >
              </div>
            </div>
          </template>
          <van-cell-group inset class="note-field"
            ><van-field
              v-model="tripForm.note"
              label="備註"
              type="textarea"
              autosize
              placeholder="選填，例如：下班順路載回家"
              clearable
          /></van-cell-group>
        </div>
        <div class="sheet-footer">
          <van-button block type="primary" native-type="submit">{{
            editingTripId ? '儲存變更' : '儲存行程'
          }}</van-button>
        </div>
      </form>
    </van-popup>
  </section>
</template>

<style scoped>
.trip-page {
  min-height: 100vh;
  padding: 20px max(16px, env(safe-area-inset-left)) calc(92px + env(safe-area-inset-bottom))
    max(16px, env(safe-area-inset-right));
  background: radial-gradient(circle at 12% 0, #e8f4ff 0, transparent 260px), #f5f7fa;
  color: #1b2a3b;
}
.trip-page__header,
.overview__top,
.section-heading,
.trip-card__top,
.charge-row,
.trip-card__actions,
.pending-list__row,
.passenger-stats__row,
.sheet-header,
.form-step {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.trip-page__header {
  gap: 18px;
  padding: 0 2px 12px;
}
.eyebrow {
  margin: 0 0 5px;
  color: #6883a1;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
}
.trip-page__header h1 {
  margin: 0;
  font-size: 29px;
  line-height: 1.2;
  font-weight: 800;
}
.trip-page__header p:last-child {
  margin: 8px 0 0;
  color: #657588;
  font-size: 13px;
}
.header-icon {
  display: grid;
  flex: 0 0 46px;
  height: 46px;
  place-items: center;
  border-radius: 15px;
  background: #deecfc;
  color: #1475d7;
  font-size: 24px;
}
.overview {
  padding: 20px;
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 12px 28px rgba(29, 66, 106, 0.07);
}
.overview h2,
.section-heading h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 800;
}
.today-link {
  min-height: 38px;
  padding: 0 10px;
  border: 0;
  background: none;
  color: #1976d2;
  font-size: 13px;
  font-weight: 700;
}
.week-switcher {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 17px;
  padding: 5px;
  border: 1px solid #e6edf5;
  border-radius: 14px;
  background: #f8fafc;
}
.week-switcher button {
  width: 42px;
  height: 42px;
  border: 0;
  border-radius: 10px;
  background: #fff;
  color: #345474;
  font-size: 17px;
  box-shadow: 0 2px 5px rgba(29, 66, 106, 0.06);
}
.week-switcher__label {
  display: grid;
  gap: 1px;
  text-align: center;
}
.week-switcher__label strong {
  font-size: 15px;
  font-weight: 800;
}
.week-switcher__label span {
  color: #8290a0;
  font-size: 11px;
}
.overview__hero {
  display: grid;
  gap: 3px;
  padding: 23px 2px 20px;
  border-bottom: 1px solid #edf1f5;
}
.overview__hero span {
  color: #657588;
  font-size: 13px;
}
.overview__hero strong {
  color: #166dd1;
  font-size: clamp(32px, 9vw, 40px);
  line-height: 1.15;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.overview__hero small {
  color: #8b98a7;
  font-size: 11px;
}
.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding-top: 18px;
}
.summary-stat {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
}
.summary-stat div {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.summary-stat span:not(.stat-dot) {
  color: #657588;
  font-size: 12px;
}
.summary-stat strong {
  font-size: clamp(15px, 4.2vw, 20px);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.summary-stat--paid strong {
  color: #167c58;
}
.summary-stat--pending strong {
  color: #b66b15;
}
.stat-dot {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: currentColor;
}
.summary-stat--paid .stat-dot {
  color: #22a875;
}
.summary-stat--pending .stat-dot {
  color: #e39b3b;
}
.new-trip-button {
  height: 52px;
  margin-top: 16px;
  border-radius: 15px;
  font-size: 16px;
  font-weight: 800;
  box-shadow: 0 8px 18px rgba(25, 137, 250, 0.2);
}
.trip-section {
  margin-top: 30px;
}
.section-heading {
  margin: 0 2px 13px;
}
.section-count {
  margin-left: 5px;
  color: #91a1b1;
  font-size: 14px;
  font-weight: 600;
}
.empty-card {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 35px 18px;
  border: 1px dashed #d6e1ed;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.75);
  text-align: center;
}
.empty-card__icon {
  color: #8aadd1;
  font-size: 27px;
}
.empty-card strong {
  font-size: 15px;
  font-weight: 700;
}
.empty-card span {
  color: #7c8b9b;
  font-size: 12px;
}
.trip-card {
  margin-top: 11px;
  padding: 17px;
  border: 1px solid #e8eef5;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 5px 16px rgba(29, 66, 106, 0.035);
}
.trip-card__top {
  gap: 8px;
  align-items: flex-start;
}
.trip-card__date {
  font-size: 15px;
  font-weight: 800;
}
.trip-card__meta {
  margin-top: 4px;
  color: #738396;
  font-size: 12px;
}
.trip-card__amount {
  color: #166dd1;
  font-size: 21px;
  font-weight: 800;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.trip-card__charges {
  margin-top: 15px;
  padding: 4px 0;
  border-top: 1px solid #f0f3f6;
}
.charge-row {
  gap: 8px;
  min-height: 34px;
  font-size: 13px;
}
.charge-row__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.charge-row__amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.status-pill {
  flex: 0 0 auto;
  min-width: 40px;
  padding: 3px 6px;
  border-radius: 7px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
}
.status-pill--paid {
  background: #e6f7ef;
  color: #13764d;
}
.status-pill--pending {
  background: #fff1dc;
  color: #ab6511;
}
.trip-card__note {
  margin: 9px 0;
  color: #758396;
  font-size: 12px;
  line-height: 1.5;
}
.trip-card__actions {
  gap: 8px;
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid #f0f3f6;
}
.trip-card__actions button {
  min-height: 38px;
  padding: 0 8px;
  border: 0;
  background: none;
  color: #176fcb;
  font-size: 13px;
  font-weight: 700;
}
.trip-card__actions .trip-card__delete {
  color: #a55d61;
  font-weight: 600;
}
.pending-list,
.passenger-stats {
  padding: 5px 16px;
  border: 1px solid #e8eef5;
  border-radius: 17px;
  background: #fff;
}
.pending-list__row,
.passenger-stats__row {
  min-height: 48px;
  gap: 12px;
  border-bottom: 1px solid #eef1f5;
  font-size: 14px;
}
.pending-list__row:last-child,
.passenger-stats__row:last-child {
  border-bottom: 0;
}
.pending-list__row strong {
  color: #a96513;
  font-weight: 800;
}
.people-section {
  overflow: hidden;
  border: 1px solid #e8eef5;
  border-radius: 17px;
  background: #fff;
}
.people-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 76px;
  padding: 14px 16px;
  border: 0;
  background: #fff;
  text-align: left;
  color: #304257;
}
.people-toggle__icon {
  display: grid;
  flex: 0 0 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  background: #eaf3fe;
  color: #1976d2;
  font-size: 20px;
}
.people-toggle__text {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 3px;
}
.people-toggle__text strong {
  font-size: 16px;
  font-weight: 800;
}
.people-toggle__text small {
  color: #798a9b;
  font-size: 11px;
}
.people-content {
  padding: 0 16px 12px;
}
.add-person-button {
  height: 43px;
  margin-bottom: 8px;
  border-radius: 10px;
}
.people-empty {
  padding: 12px;
  color: #798a9b;
  font-size: 12px;
  text-align: center;
}
.person-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 58px;
  padding: 8px 0;
  border: 0;
  border-top: 1px solid #edf1f5;
  background: #fff;
  text-align: left;
  color: #44556a;
}
.person-row__avatar {
  display: grid;
  flex: 0 0 34px;
  height: 34px;
  place-items: center;
  border-radius: 50%;
  background: #edf2f7;
  color: #38617f;
  font-size: 13px;
  font-weight: 800;
}
.person-row__body {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.person-row__body strong {
  font-size: 13px;
  font-weight: 700;
}
.person-row__body small {
  overflow: hidden;
  color: #8392a0;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.passenger-stats__row span:first-child {
  display: grid;
  gap: 1px;
}
.passenger-stats__row strong {
  font-size: 13px;
  font-weight: 700;
}
.passenger-stats__row small {
  color: #8392a0;
  font-size: 11px;
}
.passenger-stats__row > span:last-child {
  font-weight: 700;
}
.memory-notice {
  margin: 0 2px 16px;
  color: #6d7d8e;
  font-size: 11px;
  line-height: 1.5;
}
.memory-notice .van-icon {
  margin-right: 3px;
}
.sheet-form {
  display: flex;
  flex-direction: column;
  max-height: min(88dvh, 850px);
  padding-bottom: env(safe-area-inset-bottom);
  background: #f6f8fb;
}
.sheet-header {
  flex: 0 0 auto;
  padding: 19px 18px 15px;
  background: #fff;
}
.sheet-header h2 {
  margin: 0;
  font-size: 21px;
  font-weight: 800;
}
.sheet-header button {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: #f0f3f6;
  color: #607080;
  font-size: 17px;
}
.sheet-scroll {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px 0 28px;
  scroll-padding-bottom: 120px;
}
.sheet-note {
  margin: 0 18px 15px;
  color: #718195;
  font-size: 12px;
  line-height: 1.5;
}
.sheet-form :deep(.van-cell-group--inset) {
  margin: 0 16px;
  overflow: hidden;
  border-radius: 13px;
}
.sheet-form :deep(.van-field__label) {
  width: 105px;
  color: #526477;
}
.form-step {
  justify-content: flex-start;
  gap: 9px;
  margin: 5px 18px 13px;
}
.form-step:not(:first-child) {
  margin-top: 25px;
}
.form-step h3 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}
.form-step small {
  color: #8190a0;
  font-size: 12px;
}
.step-number {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 8px;
  background: #e0efff;
  color: #1475d7;
  font-size: 12px;
  font-weight: 800;
}
.field-label {
  margin: 16px 18px 8px;
  color: #617388;
  font-size: 12px;
  font-weight: 700;
}
.choice-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  margin: 0 16px;
}
.choice-grid :deep(.van-radio) {
  display: flex;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  border: 1px solid #dce5ee;
  border-radius: 10px;
  background: #fff;
}
.choice-grid :deep(.van-radio:has(.van-radio__icon--checked)) {
  border-color: #1989fa;
  background: #eef7ff;
}
.choice-grid :deep(.van-radio__icon) {
  display: none;
}
.choice-grid :deep(.van-radio__label) {
  margin: 0;
  color: #506176;
  font-size: 13px;
  font-weight: 700;
}
.choice-grid :deep(.van-radio:has(.van-radio__icon--checked) .van-radio__label) {
  color: #176fcb;
}
.form-hint {
  margin: 0 16px;
  padding: 17px;
  border: 1px dashed #d7e2ed;
  border-radius: 12px;
  color: #7a8997;
  font-size: 12px;
  text-align: center;
}
.person-choices {
  display: grid;
  gap: 9px;
  margin: 0 16px;
}
.person-choices :deep(.van-checkbox) {
  min-height: 48px;
  padding: 0 13px;
  border: 1px solid #e1e9f1;
  border-radius: 10px;
  background: #fff;
}
.person-choices :deep(.van-checkbox__label) {
  flex: 1;
}
.charge-editor {
  margin: 0 16px;
  padding: 0 13px;
  border-radius: 13px;
  background: #fff;
}
.charge-editor__row {
  display: grid;
  gap: 8px;
  padding: 14px 0;
  border-bottom: 1px solid #edf1f5;
}
.charge-editor__row:last-child {
  border-bottom: 0;
}
.charge-editor__row > strong {
  font-size: 14px;
  font-weight: 800;
}
.charge-editor__row :deep(.van-field) {
  padding: 9px 12px;
  border: 1px solid #e1e9f1;
  border-radius: 9px;
  background: #fbfcfe;
}
.charge-editor__row :deep(.van-field__label) {
  width: 56px;
}
.payment-choices {
  display: flex;
  gap: 20px;
  padding: 2px 4px;
}
.payment-choices :deep(.van-radio) {
  min-height: 38px;
}
.note-field {
  margin-top: 19px !important;
}
.sheet-footer {
  flex: 0 0 auto;
  padding: 12px 16px max(14px, env(safe-area-inset-bottom));
  border-top: 1px solid #e9edf2;
  background: #fff;
}
.sheet-footer :deep(.van-button) {
  height: 48px;
  border-radius: 11px;
  font-size: 15px;
  font-weight: 800;
}
@media (max-width: 360px) {
  .overview {
    padding: 16px;
  }
  .trip-card__amount {
    font-size: 18px;
  }
  .summary-stat strong {
    font-size: 15px;
  }
}
</style>

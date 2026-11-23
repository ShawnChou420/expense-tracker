import { ref, watch } from 'vue'
import {
  expenseRepository,
  financialEntryRepository,
  passengerRepository,
  salaryDepositRepository,
  subscribeToLedgerChanges,
  tripRepository,
} from '../repositories/appRepositories.js'
import { authToken } from '../services/authSession.js'

/**
 * 班表日曆用的車資、支出、乘客、發薪入帳與通用手動交易（唯讀快照）。
 * 第一次需要時才讀取（ensureLoaded）；之後任何頁面存檔都會 notifyLedgerChanged，這裡跟著重讀，
 * 所以日曆金額與首頁 Dashboard 用的是同一份資料來源。登入身分變更時清空，下次需要再讀。
 * @param {(error: Error) => void} [onError]
 */
export function useLedgerSnapshot(onError = () => {}) {
  const trips = ref([])
  const expenses = ref([])
  const passengers = ref([])
  /** @type {import('vue').Ref<Array<any> | null>} */
  const salaryDeposits = ref(null)
  /** @type {import('vue').Ref<Array<any>>} */
  const entries = ref([])
  const loaded = ref(false)
  let wanted = false
  let seq = 0

  async function refresh() {
    const current = ++seq
    try {
      const [nextTrips, nextExpenses, nextPassengers, nextDeposits, nextEntries] = await Promise.all([
        tripRepository.list(),
        expenseRepository.list(),
        passengerRepository.list(),
        salaryDepositRepository.list().catch(() => null),
        // 手動交易讀取失敗時不擋住日曆其他資料
        financialEntryRepository.list().catch(() => []),
      ])
      if (current !== seq) return
      trips.value = nextTrips || []
      expenses.value = nextExpenses || []
      passengers.value = nextPassengers || []
      salaryDeposits.value = nextDeposits
      entries.value = nextEntries || []
      loaded.value = true
    } catch (error) {
      if (current === seq) onError(/** @type {Error} */ (error))
    }
  }

  function ensureLoaded() {
    wanted = true
    if (!loaded.value) refresh()
  }

  subscribeToLedgerChanges(() => {
    if (wanted) refresh()
  })

  watch(authToken, () => {
    seq += 1
    loaded.value = false
    trips.value = []
    expenses.value = []
    passengers.value = []
    salaryDeposits.value = null
    entries.value = []
    if (wanted) refresh()
  })

  return {
    trips,
    expenses,
    passengers,
    salaryDeposits,
    entries,
    loaded,
    ensureLoaded,
    refresh,
  }
}

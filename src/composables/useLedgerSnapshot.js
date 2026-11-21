import { ref, watch } from 'vue'
import {
  expenseRepository,
  passengerRepository,
  salaryDepositRepository,
  subscribeToLedgerChanges,
  tripRepository,
} from '../repositories/appRepositories.js'
import { authToken } from '../services/authSession.js'

/**
 * 班表日曆用的車資、支出、乘客與發薪入帳（唯讀快照）。
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
  const loaded = ref(false)
  let wanted = false
  let seq = 0

  async function refresh() {
    const current = ++seq
    try {
      const [nextTrips, nextExpenses, nextPassengers, nextDeposits] = await Promise.all([
        tripRepository.list(),
        expenseRepository.list(),
        passengerRepository.list(),
        salaryDepositRepository.list().catch(() => null),
      ])
      if (current !== seq) return
      trips.value = nextTrips || []
      expenses.value = nextExpenses || []
      passengers.value = nextPassengers || []
      salaryDeposits.value = nextDeposits
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
    if (wanted) refresh()
  })

  return {
    trips,
    expenses,
    passengers,
    salaryDeposits,
    loaded,
    ensureLoaded,
    refresh,
  }
}

// 封閉 Beta 前的 API 安全與資料隔離測試（直接打後端，不經過畫面）。
// 只能對「全新、測試用」的資料庫執行：會註冊測試帳號並刪除其中一個。
//
// 用法：API_BASE=http://127.0.0.1:18080/api node .github/scripts/api-isolation.mjs
// 結果以 JSON 印出；任何一項失敗時以 exit code 1 結束。

const API = process.env.API_BASE || 'http://127.0.0.1:8080/api'
const results = []
const stamp = Date.now()

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) })
}

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: response.status, data }
}

const login = (email, password) => call('POST', '/auth/login', { body: { email, password } })

// 後端有開 Email 驗證時（CI 用 Mailpit），先寄驗證碼再註冊
const mailApi = process.env.MAILPIT_URL || 'http://127.0.0.1:8025'
const emailVerification = (await call('GET', '/auth/config')).data?.emailVerification === true

async function latestCode(email) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${mailApi}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    const data = await res.json()
    const code = (data.messages || []).map((m) => m.Subject.match(/(\d{6})$/)?.[1]).find(Boolean)
    if (code) return code
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`沒有收到 ${email} 的驗證碼`)
}

async function register(email, password) {
  if (!emailVerification) return call('POST', '/auth/register', { body: { email, password } })
  const sent = await call('POST', '/auth/email-code', { body: { email, purpose: 'REGISTER' } })
  if (sent.status >= 300) return sent
  const code = await latestCode(email)
  return call('POST', '/auth/register', { body: { email, password, code } })
}

// ---------- 1. 註冊、登入、登出與 Token ----------
const emailA = `beta-a-${stamp}@example.test`
const emailB = `beta-b-${stamp}@example.test`
const passA = 'Beta-pass1'
const passB = 'Beta-pass2'

const weak = await call('POST', '/auth/register', {
  body: { email: `weak-${stamp}@example.test`, password: 'abcd1234' },
})
check('註冊：缺大寫與符號的密碼被拒絕（400）', weak.status === 400, weak)

const regA = await register(emailA, passA)
const regB = await register(emailB, passB)
check('註冊：A、B 兩個帳號建立成功', regA.status === 200 && regB.status === 200, { regA, regB })
const dup = await register(emailA.toUpperCase(), passA)
check('註冊：同一 Email（大小寫不同）不能重複註冊', dup.status === 409, dup)
const tokenA = regA.data?.token
const tokenB = regB.data?.token

check('未登入讀取私人資料回 401', (await call('GET', '/expenses')).status === 401)
check('假 token 回 401', (await call('GET', '/expenses', { token: 'x'.repeat(43) })).status === 401)
const wrongLogin = await login(emailA, 'Wrong-pass1')
check('登入：密碼錯誤回 401 且不透露帳號是否存在', wrongLogin.status === 401 &&
  (await login(`nobody-${stamp}@example.test`, 'Wrong-pass1')).data?.detail === wrongLogin.data?.detail, wrongLogin)

const extra = await login(emailB, passB)
const logout = await call('POST', '/auth/logout', { token: extra.data?.token })
check('登出後該 token 失效', logout.status === 204 &&
  (await call('GET', '/auth/me', { token: extra.data?.token })).status === 401)
check('登出只影響該裝置，其他 token 仍有效', (await call('GET', '/auth/me', { token: tokenB })).status === 200)

// ---------- 2. A 建立各種資料 ----------
const day = '2026-11-17'
const shiftA = { id: 'shift-a', workDate: day, startTime: '23:50', endTime: '06:00', grossPay: 250.5,
  totalMinutes: 370, smokoCount: 1, shiftType: 'normal', isCleaningDay: false }
const expenseA = { id: 'exp-a', date: day, amountCents: 4590, category: '超市', group: 'LIVING',
  status: 'PAID', frequency: 'NONE', note: 'A 的支出' }
const shopA = { id: 'shop-a', name: 'A 的牛奶', unit: '瓶', quantity: 2, purchasedQuantity: 0,
  priority: 'NORMAL', bucket: 'NOW', store: 'ANY', note: '' }
const depositId = crypto.randomUUID()
const depositA = { paidAt: day, amountCents: 98765, grossCents: 120000, taxCents: 21235 }

const created = await Promise.all([
  call('PUT', '/work-records/shift-a', { token: tokenA, body: shiftA }),
  call('PUT', '/expenses/exp-a', { token: tokenA, body: expenseA }),
  call('PUT', '/shopping-items/shop-a', { token: tokenA, body: shopA }),
  call('PUT', `/salary-deposits/${depositId}`, { token: tokenA, body: depositA }),
  call('PUT', '/dashboard-settings/saving-goal', { token: tokenA,
    body: { name: 'A 的旅費', targetCents: 500000, initialCents: 10000, startDate: '2026-11-01' } }),
  call('PUT', '/leave-blackouts/2026-11-20', { token: tokenA, body: { reason: 'A 的禁休' } }),
  call('PUT', '/work-profile', { token: tokenA, body: { version: 1, shiftTemplates: [] } }),
])
check('A：班表、支出、採買、入帳、存款目標、禁休、工作設定都能新增', created.every((r) => r.status < 300),
  created.map((r) => r.status))

// ---------- 3. 資料隔離 ----------
const listsB = await Promise.all(['/work-records', '/expenses', '/shopping-items', '/salary-deposits',
  '/leave-blackouts', '/payslip-imports'].map((path) => call('GET', path, { token: tokenB })))
check('B 看不到 A 的任何清單資料', listsB.every((r) => r.status === 200 && Array.isArray(r.data) && r.data.length === 0),
  listsB.map((r) => r.data))
const settingsB = await call('GET', '/dashboard-settings', { token: tokenB })
check('B 看不到 A 的存款目標', settingsB.status === 200 && !settingsB.data?.savingGoal, settingsB.data)
const profileB = await call('GET', '/work-profile', { token: tokenB })
check('B 看不到 A 的工作設定', profileB.status === 200 && !profileB.data?.profile, profileB.data)

// B 用 A 的 ID 寫入／刪除：只能影響 B 自己
await call('PUT', '/expenses/exp-a', { token: tokenB, body: { ...expenseA, amountCents: 1, note: 'B 改的' } })
await call('DELETE', '/work-records/shift-a', { token: tokenB })
await call('DELETE', '/shopping-items/shop-a', { token: tokenB })
await call('DELETE', `/salary-deposits/${depositId}`, { token: tokenB })
const hijack = await call('PUT', `/salary-deposits/${depositId}`, { token: tokenB, body: { ...depositA, amountCents: 1 } })
const [expA, workA, shopListA, depA] = await Promise.all(
  ['/expenses', '/work-records', '/shopping-items', '/salary-deposits'].map((p) => call('GET', p, { token: tokenA })),
)
check('B 用相同 ID 寫入，不會改到 A 的支出', expA.data?.length === 1 && expA.data[0].amountCents === 4590, expA.data)
check('B 刪除 A 的班表 ID，A 的班表仍在', workA.data?.length === 1, workA.data)
check('B 刪除 A 的採買 ID，A 的採買仍在', shopListA.data?.length === 1, shopListA.data)
check('B 不能覆寫或刪除 A 的薪資入帳（UUID 全域唯一）',
  depA.data?.length === 1 && depA.data[0].amountCents === 98765 && hijack.status >= 400, { hijack: hijack.status, depA: depA.data })
check('B 撞到 A 的入帳 UUID 時不回 500', hijack.status !== 500, hijack)

// ---------- 4. 修改、刪除與持久化 ----------
await call('PUT', '/expenses/exp-a', { token: tokenA, body: { ...expenseA, amountCents: 5000 } })
await call('PUT', '/shopping-items/shop-a', { token: tokenA, body: { ...shopA, purchasedQuantity: 2 } })
const relogin = await login(emailA, passA)
const tokenA2 = relogin.data?.token
const [exp2, shop2] = await Promise.all(['/expenses', '/shopping-items'].map((p) => call('GET', p, { token: tokenA2 })))
check('A 修改後重新登入，支出金額已更新', exp2.data?.[0]?.amountCents === 5000, exp2.data)
check('A 修改後重新登入，採買進度已保存', shop2.data?.[0]?.purchasedQuantity === 2, shop2.data)
await call('DELETE', '/expenses/exp-a', { token: tokenA2 })
check('A 刪除支出後清單為空', (await call('GET', '/expenses', { token: tokenA2 })).data?.length === 0)

// ---------- 5. 修改密碼 ----------
const badChange = await call('POST', '/account/password', { token: tokenA2,
  body: { currentPassword: 'Wrong-pass1', newPassword: 'Newer-pass1' } })
check('改密碼：目前密碼錯誤回 400（不是 401，不會把人登出）', badChange.status === 400, badChange)
const weakChange = await call('POST', '/account/password', { token: tokenA2,
  body: { currentPassword: passA, newPassword: 'abcdefgh' } })
check('改密碼：新密碼不符規則回 400', weakChange.status === 400, weakChange)
const change = await call('POST', '/account/password', { token: tokenA2,
  body: { currentPassword: passA, newPassword: 'Newer-pass1' } })
check('改密碼成功', change.status === 204, change)
check('改密碼後：目前裝置仍登入', (await call('GET', '/auth/me', { token: tokenA2 })).status === 200)
check('改密碼後：其他裝置被登出', (await call('GET', '/auth/me', { token: tokenA })).status === 401)
check('改密碼後：舊密碼不能登入', (await login(emailA, passA)).status === 401)

// ---------- 6. 刪除帳號 ----------
const badDelete = await call('POST', '/account/delete', { token: tokenA2, body: { password: passA } })
check('刪帳號：密碼錯誤回 400，資料不動', badDelete.status === 400 &&
  (await call('GET', '/work-records', { token: tokenA2 })).data?.length === 1, badDelete)
const del = await call('POST', '/account/delete', { token: tokenA2, body: { password: 'Newer-pass1' } })
check('刪帳號成功', del.status === 204, del)
check('刪帳號後 token 失效', (await call('GET', '/auth/me', { token: tokenA2 })).status === 401)
check('刪帳號後不能再登入', (await login(emailA, 'Newer-pass1')).status === 401)
check('刪帳號後同一 Email 可以重新註冊（資料已清空）',
  (await register(`again-${emailA}`, passA)).status === 200 &&
    (await register(emailA, passA)).status === 200)
check('刪除 A 不影響 B', (await call('GET', '/auth/me', { token: tokenB })).status === 200)

// ---------- 7. 錯誤處理 ----------
const huge = await call('PUT', '/expenses/huge', { token: tokenB,
  body: { ...expenseA, id: 'huge', note: 'x'.repeat(300 * 1024) } })
check('超大請求（300 KB）回 413，不寫入', huge.status === 413, huge.status)
const badType = await call('PUT', '/work-records/bad', { token: tokenB,
  body: { ...shiftA, id: 'bad', totalMinutes: 'abc' } })
check('欄位型別錯誤回 400，不是 500', badType.status === 400, badType)

const failed = results.filter((item) => !item.ok)
console.log(JSON.stringify({ api: API, passed: results.length - failed.length, failed: failed.length, results }, null, 2))
process.exit(failed.length ? 1 : 0)

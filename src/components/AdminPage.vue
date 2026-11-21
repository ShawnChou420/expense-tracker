<script setup>
// 管理後台（只有 SUPER_ADMIN 看得到入口；每個 API 都由後端重新驗證權限）。
// 只顯示非敏感資訊：事件摘要、錯誤代碼與 request id，不顯示密碼、token、薪資單內容或完整請求。
import { computed, onMounted, ref, watch } from 'vue'
import { showToast } from 'vant'
import { adminRepository } from '../repositories/adminRepository.js'
import { authEmail } from '../services/authSession.js'
import SupermarketImportPanel from './SupermarketImportPanel.vue'

const emit = defineEmits(['back'])

const TABS = [
  { id: 'overview', label: '總覽' },
  { id: 'users', label: '會員' },
  { id: 'logs', label: '紀錄' },
  { id: 'audit', label: '稽核' },
  { id: 'specials', label: '特價' },
]
const tab = ref('overview')

const EVENT_LABELS = {
  REGISTER_SUCCESS: '註冊成功',
  LOGIN_SUCCESS: '登入成功',
  LOGIN_FAILED: '登入失敗',
  LOGOUT: '登出',
  PAYSLIP_IMPORT_SUCCESS: '薪資單匯入成功',
  PAYSLIP_IMPORT_FAILED: '薪資單匯入失敗',
  WORK_SETUP_COMPLETED: '完成工作設定',
  SHIFT_CREATED: '新增班表',
  SHIFT_UPDATED: '修改班表',
  FILL_MONTH_COMPLETED: '填滿班表',
  EXPENSE_CREATED: '新增支出',
  EXPENSE_UPDATED: '修改支出',
  VISA_TRACKING_ENABLED: '開始集簽追蹤',
  VISA_HISTORY_IMPORTED: '補登歷史班表',
  ACCOUNT_DELETED: '刪除帳號',
  API_ERROR: 'API 錯誤',
  DB_ERROR: '資料庫錯誤',
  DB_CONSTRAINT_VIOLATION: '資料限制衝突',
  ADMIN_ACCESS_DENIED: '無權限存取管理 API',
}
const CATEGORY_LABELS = {
  USER: '使用者操作',
  API_ERROR: 'API 錯誤',
  PAYSLIP: '薪資單',
  DATABASE: '資料庫',
  ADMIN_SECURITY: '管理安全',
}
const AUDIT_LABELS = {
  EDIT_PROFILE: '編輯基本資料',
  DISABLE_USER: '停用會員',
  ENABLE_USER: '恢復會員',
  GRANT_SUPER_ADMIN: '授予管理員',
  REVOKE_SUPER_ADMIN: '移除管理員',
  DELETE_USER: '刪除會員',
}
const eventLabel = (type) => EVENT_LABELS[type] || type
const formatTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
const who = (email, seq) => (email ? `${email}（#${seq}）` : seq ? `#${seq}（已刪除）` : '—')

async function guard(task) {
  try {
    return await task()
  } catch (error) {
    showToast(error.message || '讀取失敗')
    return null
  }
}

// ---------- 總覽 ----------
const overview = ref(null)
async function loadOverview() {
  overview.value = await guard(() => adminRepository.overview())
}

// ---------- 會員列表 ----------
const userQuery = ref('')
const userStatus = ref('')
const users = ref({ items: [], total: 0, page: 0, size: 20 })
const usersLoading = ref(false)
async function loadUsers(page = 0) {
  usersLoading.value = true
  const result = await guard(() => adminRepository.users({ q: userQuery.value.trim(), status: userStatus.value, page }))
  usersLoading.value = false
  if (result) users.value = page === 0 ? result : { ...result, items: [...users.value.items, ...result.items] }
}
const hasMoreUsers = computed(() => users.value.items.length < users.value.total)

// ---------- 會員詳細 ----------
const detail = ref({ show: false, tab: 'info', user: null, events: { items: [], total: 0, page: 0 }, audit: { items: [] } })
async function openUser(seq) {
  detail.value = { show: true, tab: 'info', user: null, events: { items: [], total: 0, page: 0 }, audit: { items: [] } }
  const user = await guard(() => adminRepository.user(seq))
  if (!user) {
    detail.value.show = false
    return
  }
  detail.value.user = user
  await Promise.all([loadUserEvents(0), loadUserAudit()])
}
async function loadUserEvents(page) {
  const seq = detail.value.user?.seq
  if (!seq) return
  const result = await guard(() => adminRepository.userEvents(seq, page))
  if (result)
    detail.value.events = page === 0 ? result : { ...result, items: [...detail.value.events.items, ...result.items] }
}
async function loadUserAudit() {
  const seq = detail.value.user?.seq
  if (!seq) return
  const result = await guard(() => adminRepository.audit({ targetSeq: seq }))
  if (result) detail.value.audit = result
}
const isSelf = computed(() => detail.value.user?.email === authEmail.value)

// ---------- 管理操作（需要原因；敏感操作需要再次輸入密碼） ----------
const action = ref({ show: false, kind: '', title: '', description: '', reason: '', password: '', nickname: '', confirmEmail: '', busy: false, error: '' })
const ACTIONS = {
  profile: { title: '編輯顯示名稱', description: '只修改顯示名稱，不會改到登入 Email。', password: false },
  disable: { title: '停用會員', description: '停用後會立即登出，且無法再登入；資料會保留，可以恢復。', password: true },
  enable: { title: '恢復會員', description: '恢復後會員可以重新登入。', password: true },
  grant: { title: '授予管理員', description: '這位會員將可以看到管理後台並管理所有會員。', password: true },
  revoke: { title: '移除管理員', description: '最後一位管理員不能移除。', password: true },
  delete: { title: '刪除會員', description: '會永久刪除這位會員的所有私人資料，無法復原。稽核紀錄會保留。', password: true },
}
function openAction(kind) {
  const config = ACTIONS[kind]
  action.value = {
    show: true,
    kind,
    title: config.title,
    description: config.description,
    reason: '',
    password: '',
    nickname: kind === 'profile' ? detail.value.user?.nickname || '' : '',
    confirmEmail: '',
    busy: false,
    error: '',
  }
}
const actionNeedsPassword = computed(() => ACTIONS[action.value.kind]?.password === true)
async function submitAction() {
  const value = action.value
  const user = detail.value.user
  if (!user) return
  if (value.reason.trim().length < 5) {
    value.error = '請填寫原因（至少 5 個字）'
    return
  }
  if (actionNeedsPassword.value && !value.password) {
    value.error = '請輸入你的密碼確認'
    return
  }
  value.busy = true
  value.error = ''
  try {
    const reason = value.reason.trim()
    if (value.kind === 'profile')
      await adminRepository.updateProfile(user.seq, { nickname: value.nickname.trim() || null, reason })
    else if (value.kind === 'disable' || value.kind === 'enable')
      await adminRepository.setActive(user.seq, value.kind === 'enable', { reason, password: value.password })
    else if (value.kind === 'grant' || value.kind === 'revoke')
      await adminRepository.setRole(user.seq, { superAdmin: value.kind === 'grant', reason, password: value.password })
    else if (value.kind === 'delete')
      await adminRepository.remove(user.seq, { reason, password: value.password, confirmEmail: value.confirmEmail })
    action.value.show = false
    showToast(`${value.title}完成`)
    if (value.kind === 'delete') {
      detail.value.show = false
      users.value.items = users.value.items.filter((item) => item.seq !== user.seq)
      users.value.total = Math.max(0, users.value.total - 1)
    } else {
      await openUser(user.seq)
      detail.value.tab = 'info'
      loadUsers(0)
    }
  } catch (error) {
    value.error = error.message || '操作失敗'
  } finally {
    value.busy = false
  }
}

// ---------- 事件紀錄 ----------
const logFilter = ref({ from: '', to: '', userSeq: '', type: '', status: '', category: '' })
const logs = ref({ items: [], total: 0, page: 0, size: 20 })
async function loadLogs(page = 0) {
  const result = await guard(() => adminRepository.events({ ...logFilter.value, page }))
  if (result) logs.value = result
}
const logPages = computed(() => Math.max(1, Math.ceil(logs.value.total / (logs.value.size || 20))))
function showRecentErrors() {
  logFilter.value = { from: '', to: '', userSeq: '', type: '', status: 'FAILURE', category: '' }
  tab.value = 'logs'
}
const eventDetail = ref(null)

// ---------- 稽核紀錄 ----------
const audit = ref({ items: [], total: 0, page: 0, size: 20 })
async function loadAudit(page = 0) {
  const result = await guard(() => adminRepository.audit({ page }))
  if (result) audit.value = result
}
const auditPages = computed(() => Math.max(1, Math.ceil(audit.value.total / (audit.value.size || 20))))

watch(tab, (next) => {
  if (next === 'overview') loadOverview()
  if (next === 'users') loadUsers(0)
  if (next === 'logs') loadLogs(0)
  if (next === 'audit') loadAudit(0)
})
onMounted(loadOverview)
</script>

<template>
  <main class="admin-page app-page">
    <header class="admin-header">
      <button type="button" class="admin-header__back" aria-label="返回更多" @click="emit('back')">
        <van-icon name="arrow-left" />
      </button>
      <div>
        <p class="admin-header__eyebrow">SUPER ADMIN</p>
        <h1>管理後台</h1>
      </div>
    </header>

    <nav class="admin-tabs" role="tablist" aria-label="管理後台">
      <button
        v-for="item in TABS"
        :key="item.id"
        type="button"
        role="tab"
        class="admin-tabs__tab"
        :class="{ 'is-active': tab === item.id }"
        :aria-selected="tab === item.id"
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </nav>

    <!-- 總覽 -->
    <section v-if="tab === 'overview'" class="admin-section">
      <div v-if="overview" class="admin-stats">
        <div><strong>{{ overview.users.total }}</strong><span>會員總數</span></div>
        <div><strong>{{ overview.users.active }}</strong><span>啟用中</span></div>
        <div><strong>{{ overview.users.disabled }}</strong><span>已停用</span></div>
        <div><strong>{{ overview.users.newLast7Days }}</strong><span>7 天新註冊</span></div>
        <div><strong>{{ overview.users.activeLast7Days }}</strong><span>7 天有登入</span></div>
        <div><strong>{{ overview.users.admins }}</strong><span>管理員</span></div>
        <div><strong>{{ overview.events.last24h }}</strong><span>24 小時事件</span></div>
        <div :class="{ 'is-alert': overview.events.failures24h > 0 }"><strong>{{ overview.events.failures24h }}</strong><span>24 小時失敗</span></div>
        <div :class="{ 'is-alert': overview.events.payslipFailures7d > 0 }"><strong>{{ overview.events.payslipFailures7d }}</strong><span>7 天薪資單失敗</span></div>
        <div :class="{ 'is-alert': overview.events.systemErrors7d > 0 }"><strong>{{ overview.events.systemErrors7d }}</strong><span>7 天系統錯誤</span></div>
      </div>
      <div class="admin-section__head">
        <h2>最近的錯誤</h2>
        <van-button size="small" plain type="primary" @click="showRecentErrors">查看全部</van-button>
      </div>
      <p v-if="overview && !overview.recentErrors.length" class="admin-empty">目前沒有錯誤。</p>
      <button v-for="event in overview?.recentErrors || []" :key="event.eventId" type="button" class="admin-row" @click="eventDetail = event">
        <span class="admin-row__main">
          <strong>{{ eventLabel(event.type) }}</strong>
          <small>{{ formatTime(event.occurredAt) }} · {{ who(event.email, event.userSeq) }}</small>
        </span>
        <span class="admin-tag is-failure">{{ event.errorCode || '失敗' }}</span>
      </button>
    </section>

    <!-- 會員 -->
    <section v-else-if="tab === 'users'" class="admin-section">
      <form class="admin-search" @submit.prevent="loadUsers(0)">
        <van-search v-model="userQuery" placeholder="搜尋 Email 或會員 ID" shape="round" @search="loadUsers(0)" @clear="loadUsers(0)" />
        <div class="admin-chips" role="group" aria-label="帳號狀態">
          <button v-for="option in [{ id: '', label: '全部' }, { id: 'ACTIVE', label: '啟用' }, { id: 'DISABLED', label: '停用' }]" :key="option.id" type="button" class="admin-chip" :class="{ 'is-active': userStatus === option.id }" @click="userStatus = option.id; loadUsers(0)">
            {{ option.label }}
          </button>
        </div>
      </form>
      <p class="admin-count">共 {{ users.total }} 位會員</p>
      <button v-for="user in users.items" :key="user.seq" type="button" class="admin-row" @click="openUser(user.seq)">
        <span class="admin-row__main">
          <strong>{{ user.email }}</strong>
          <small>#{{ user.seq }}{{ user.nickname ? ` · ${user.nickname}` : '' }} · 最後登入 {{ formatTime(user.lastLoginAt) }}</small>
        </span>
        <span class="admin-row__tags">
          <span v-if="user.superAdmin" class="admin-tag is-admin">管理員</span>
          <span class="admin-tag" :class="user.status === 'ACTIVE' ? 'is-success' : 'is-failure'">{{ user.status === 'ACTIVE' ? '啟用' : '停用' }}</span>
        </span>
      </button>
      <van-button v-if="hasMoreUsers" block plain :loading="usersLoading" @click="loadUsers(users.page + 1)">載入更多</van-button>
    </section>

    <!-- 事件紀錄 -->
    <section v-else-if="tab === 'logs'" class="admin-section">
      <form class="admin-filters" @submit.prevent="loadLogs(0)">
        <label><span>開始日</span><input v-model="logFilter.from" type="date" /></label>
        <label><span>結束日</span><input v-model="logFilter.to" type="date" /></label>
        <label><span>會員 ID</span><input v-model="logFilter.userSeq" inputmode="numeric" placeholder="例如 12" /></label>
        <label>
          <span>事件類型</span>
          <select v-model="logFilter.type">
            <option value="">全部</option>
            <option v-for="(label, type) in EVENT_LABELS" :key="type" :value="type">{{ label }}</option>
          </select>
        </label>
        <label>
          <span>結果</span>
          <select v-model="logFilter.status">
            <option value="">全部</option>
            <option value="SUCCESS">成功</option>
            <option value="FAILURE">失敗</option>
          </select>
        </label>
        <label>
          <span>分類</span>
          <select v-model="logFilter.category">
            <option value="">全部</option>
            <option v-for="(label, category) in CATEGORY_LABELS" :key="category" :value="category">{{ label }}</option>
          </select>
        </label>
        <van-button native-type="submit" type="primary" block class="admin-filters__submit">搜尋</van-button>
      </form>
      <p class="admin-count">共 {{ logs.total }} 筆，依時間由新到舊</p>
      <button v-for="event in logs.items" :key="event.eventId" type="button" class="admin-row" @click="eventDetail = event">
        <span class="admin-row__main">
          <strong>{{ eventLabel(event.type) }}</strong>
          <small>{{ formatTime(event.occurredAt) }} · {{ who(event.email, event.userSeq) }}</small>
        </span>
        <span class="admin-tag" :class="event.status === 'SUCCESS' ? 'is-success' : 'is-failure'">{{ event.status === 'SUCCESS' ? '成功' : event.errorCode || '失敗' }}</span>
      </button>
      <div class="admin-pager">
        <van-button size="small" :disabled="logs.page <= 0" @click="loadLogs(logs.page - 1)">上一頁</van-button>
        <span>{{ logs.page + 1 }} / {{ logPages }}</span>
        <van-button size="small" :disabled="logs.page + 1 >= logPages" @click="loadLogs(logs.page + 1)">下一頁</van-button>
      </div>
    </section>

    <!-- 超市特價 CSV 匯入 -->
    <section v-else-if="tab === 'specials'" class="admin-section">
      <SupermarketImportPanel />
    </section>

    <!-- 稽核紀錄 -->
    <section v-else class="admin-section">
      <p class="admin-count">共 {{ audit.total }} 筆管理員操作（只能新增，不能修改或刪除）</p>
      <article v-for="entry in audit.items" :key="entry.auditId" class="admin-audit">
        <div class="admin-audit__head">
          <strong>{{ AUDIT_LABELS[entry.action] || entry.action }}</strong>
          <span class="admin-tag" :class="entry.result === 'SUCCESS' ? 'is-success' : 'is-failure'">{{ entry.result === 'SUCCESS' ? '成功' : '失敗' }}</span>
        </div>
        <p>對象：{{ who(entry.targetEmail, entry.targetSeq) }}</p>
        <p>管理員：{{ entry.adminSeq ? who(entry.adminEmail, entry.adminSeq) : '初始化工具（CLI）' }}</p>
        <p>原因：{{ entry.reason }}</p>
        <small>{{ formatTime(entry.occurredAt) }}{{ entry.requestId ? ` · ${entry.requestId}` : '' }}</small>
      </article>
      <div class="admin-pager">
        <van-button size="small" :disabled="audit.page <= 0" @click="loadAudit(audit.page - 1)">上一頁</van-button>
        <span>{{ audit.page + 1 }} / {{ auditPages }}</span>
        <van-button size="small" :disabled="audit.page + 1 >= auditPages" @click="loadAudit(audit.page + 1)">下一頁</van-button>
      </div>
    </section>

    <!-- 會員詳細 -->
    <van-popup v-model:show="detail.show" position="bottom" round closeable teleport="body" class="admin-detail" :style="{ height: '92dvh' }">
      <div v-if="detail.user" class="admin-detail__body">
        <h2>{{ detail.user.email }}</h2>
        <p class="admin-detail__sub">
          #{{ detail.user.seq }} ·
          <span :class="detail.user.status === 'ACTIVE' ? 'is-success-text' : 'is-failure-text'">{{ detail.user.status === 'ACTIVE' ? '啟用中' : '已停用' }}</span>
          <template v-if="detail.user.superAdmin"> · 管理員</template>
        </p>
        <nav class="admin-tabs admin-tabs--small" role="tablist">
          <button v-for="item in [{ id: 'info', label: '資料' }, { id: 'events', label: '操作紀錄' }, { id: 'audit', label: '稽核' }]" :key="item.id" type="button" role="tab" class="admin-tabs__tab" :class="{ 'is-active': detail.tab === item.id }" :aria-selected="detail.tab === item.id" @click="detail.tab = item.id">
            {{ item.label }}
          </button>
        </nav>

        <template v-if="detail.tab === 'info'">
          <dl class="admin-fields">
            <div><dt>顯示名稱</dt><dd>{{ detail.user.nickname || '—' }}</dd></div>
            <div><dt>註冊時間</dt><dd>{{ formatTime(detail.user.createdAt) }}</dd></div>
            <div><dt>最後登入</dt><dd>{{ formatTime(detail.user.lastLoginAt) }}</dd></div>
            <div><dt>Email 驗證</dt><dd>{{ detail.user.emailVerified ? '已驗證' : '未驗證' }}</dd></div>
            <div><dt>工作設定</dt><dd>{{ detail.user.workSetup ? '已完成' : '未完成' }}</dd></div>
            <div><dt>集簽目標</dt><dd>{{ { SECOND: '集二簽', THIRD: '集三簽', NONE: '不集簽' }[detail.user.visaGoal] || '未設定' }}</dd></div>
            <div><dt>班表／支出／薪資單</dt><dd>{{ detail.user.shiftCount }}／{{ detail.user.expenseCount }}／{{ detail.user.payslipCount }} 筆</dd></div>
          </dl>
          <div class="admin-actions">
            <van-button block plain type="primary" @click="openAction('profile')">編輯顯示名稱</van-button>
            <van-button v-if="detail.user.status === 'ACTIVE'" block plain type="warning" :disabled="isSelf" @click="openAction('disable')">停用會員</van-button>
            <van-button v-else block plain type="success" @click="openAction('enable')">恢復會員</van-button>
            <van-button v-if="!detail.user.superAdmin" block plain type="primary" :disabled="detail.user.status !== 'ACTIVE'" @click="openAction('grant')">授予管理員</van-button>
            <van-button v-else block plain type="warning" @click="openAction('revoke')">移除管理員</van-button>
            <van-button block plain type="danger" :disabled="isSelf" @click="openAction('delete')">刪除會員</van-button>
          </div>
          <p v-if="isSelf" class="admin-note">這是你自己的帳號：不能在後台停用或刪除自己。</p>
        </template>

        <template v-else-if="detail.tab === 'events'">
          <p class="admin-count">共 {{ detail.events.total }} 筆（只顯示非敏感摘要，依時間由新到舊）</p>
          <button v-for="event in detail.events.items" :key="event.eventId" type="button" class="admin-row" @click="eventDetail = event">
            <span class="admin-row__main">
              <strong>{{ eventLabel(event.type) }}</strong>
              <small>{{ formatTime(event.occurredAt) }}</small>
            </span>
            <span class="admin-tag" :class="event.status === 'SUCCESS' ? 'is-success' : 'is-failure'">{{ event.status === 'SUCCESS' ? '成功' : event.errorCode || '失敗' }}</span>
          </button>
          <van-button v-if="detail.events.items.length < detail.events.total" block plain @click="loadUserEvents(detail.events.page + 1)">載入更多</van-button>
        </template>

        <template v-else>
          <p v-if="!detail.audit.items.length" class="admin-empty">沒有管理員操作紀錄。</p>
          <article v-for="entry in detail.audit.items" :key="entry.auditId" class="admin-audit">
            <div class="admin-audit__head">
              <strong>{{ AUDIT_LABELS[entry.action] || entry.action }}</strong>
              <span class="admin-tag" :class="entry.result === 'SUCCESS' ? 'is-success' : 'is-failure'">{{ entry.result === 'SUCCESS' ? '成功' : '失敗' }}</span>
            </div>
            <p>管理員：{{ entry.adminSeq ? who(entry.adminEmail, entry.adminSeq) : '初始化工具（CLI）' }}</p>
            <p>原因：{{ entry.reason }}</p>
            <small>{{ formatTime(entry.occurredAt) }}</small>
          </article>
        </template>
      </div>
    </van-popup>

    <!-- 事件詳細 -->
    <van-popup :show="Boolean(eventDetail)" position="bottom" round closeable teleport="body" class="admin-event" @update:show="!$event && (eventDetail = null)">
      <div v-if="eventDetail" class="admin-detail__body">
        <h2>{{ eventLabel(eventDetail.type) }}</h2>
        <dl class="admin-fields">
          <div><dt>時間</dt><dd>{{ formatTime(eventDetail.occurredAt) }}</dd></div>
          <div><dt>會員</dt><dd>{{ who(eventDetail.email, eventDetail.userSeq) }}</dd></div>
          <div><dt>分類</dt><dd>{{ CATEGORY_LABELS[eventDetail.category] || eventDetail.category }}</dd></div>
          <div><dt>結果</dt><dd>{{ eventDetail.status === 'SUCCESS' ? '成功' : '失敗' }}</dd></div>
          <div v-if="eventDetail.errorCode"><dt>錯誤代碼</dt><dd>{{ eventDetail.errorCode }}</dd></div>
          <div v-if="eventDetail.requestId"><dt>Request ID</dt><dd class="admin-mono">{{ eventDetail.requestId }}</dd></div>
          <div v-for="(value, key) in eventDetail.details" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div>
          <div><dt>事件類型</dt><dd class="admin-mono">{{ eventDetail.type }}</dd></div>
        </dl>
        <p class="admin-note">技術細節（例如 stack trace）只在受保護的伺服器 log，可用 Request ID 搜尋。</p>
      </div>
    </van-popup>

    <!-- 管理操作 -->
    <van-popup v-model:show="action.show" position="bottom" round closeable teleport="body" class="admin-action">
      <form class="admin-detail__body" @submit.prevent="submitAction">
        <h2>{{ action.title }}</h2>
        <p class="admin-note">{{ action.description }}</p>
        <p class="admin-note">對象：{{ detail.user?.email }}（#{{ detail.user?.seq }}）</p>
        <van-field v-if="action.kind === 'profile'" v-model="action.nickname" label="顯示名稱" maxlength="50" placeholder="留白＝清除" />
        <van-field v-model="action.reason" type="textarea" rows="2" autosize label="原因" maxlength="500" placeholder="必填，例如：會員要求修改" />
        <van-field v-if="action.kind === 'delete'" v-model="action.confirmEmail" label="會員 Email" placeholder="輸入對方 Email 確認刪除" autocomplete="off" />
        <van-field v-if="actionNeedsPassword" v-model="action.password" type="password" label="你的密碼" placeholder="再次輸入你的密碼確認" autocomplete="current-password" />
        <p v-if="action.error" class="admin-error" role="alert">{{ action.error }}</p>
        <van-button block native-type="submit" :type="action.kind === 'delete' ? 'danger' : 'primary'" :loading="action.busy" class="admin-action__submit">
          確認{{ action.title }}
        </van-button>
      </form>
    </van-popup>
  </main>
</template>

<style scoped>
.admin-page {
  padding-bottom: 96px;
}
.admin-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.admin-header__back {
  width: var(--touch-target);
  height: var(--touch-target);
  border: 0;
  border-radius: 50%;
  background: var(--color-surface);
  font-size: 18px;
  color: var(--color-heading);
}
.admin-header__eyebrow {
  margin: 0;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.admin-header h1 {
  margin: 0;
  font-size: var(--font-title);
  color: var(--color-heading);
}
.admin-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}
.admin-tabs--small {
  grid-template-columns: repeat(3, 1fr);
  margin: 12px 0;
  box-shadow: none;
  background: var(--color-background);
}
.admin-tabs__tab {
  min-height: 40px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--color-muted);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.admin-tabs__tab.is-active {
  background: var(--color-primary);
  color: #fff;
}
.admin-section {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}
.admin-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
.admin-section__head h2 {
  margin: 0;
  font-size: 16px;
}
.admin-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.admin-stats div {
  display: grid;
  gap: 2px;
  padding: 12px;
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}
.admin-stats strong {
  font-size: 22px;
  color: var(--color-heading);
}
.admin-stats span {
  font-size: 12px;
  color: var(--color-muted);
}
.admin-stats .is-alert strong {
  color: var(--color-expense);
}
.admin-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 60px;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
  font: inherit;
  text-align: left;
  color: var(--color-heading);
}
.admin-row__main {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.admin-row__main strong {
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-row__main small {
  overflow: hidden;
  color: var(--color-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-row__tags {
  display: flex;
  flex: none;
  gap: 4px;
}
.admin-tag {
  flex: none;
  max-width: 130px;
  overflow: hidden;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--color-border);
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-tag.is-success {
  background: var(--color-income-soft);
  color: var(--color-income);
}
.admin-tag.is-failure {
  background: #fdecec;
  color: var(--color-expense);
}
.admin-tag.is-admin {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.is-success-text {
  color: var(--color-income);
}
.is-failure-text {
  color: var(--color-expense);
}
.admin-search :deep(.van-search) {
  padding: 0;
  background: none;
}
.admin-chips {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.admin-chip {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
}
.admin-chip.is-active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 700;
}
.admin-count,
.admin-empty,
.admin-note {
  margin: 4px 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}
.admin-filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}
.admin-filters label {
  display: grid;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
  color: var(--color-muted);
}
.admin-filters input,
.admin-filters select {
  width: 100%;
  min-height: 40px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  font: inherit;
  font-size: 14px;
  color: var(--color-heading);
}
.admin-filters__submit {
  grid-column: 1 / -1;
}
.admin-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--color-muted);
}
.admin-audit {
  padding: 12px;
  border-radius: var(--radius-medium);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}
.admin-audit__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.admin-audit p {
  margin: 2px 0;
  font-size: 13px;
  color: var(--color-heading);
  overflow-wrap: anywhere;
}
.admin-audit small {
  color: var(--color-muted);
  font-size: 11px;
}
.admin-detail__body {
  height: 100%;
  overflow-y: auto;
  padding: 22px var(--page-inset) calc(20px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
}
.admin-detail__body h2 {
  margin: 0 32px 4px 0;
  font-size: 17px;
  overflow-wrap: anywhere;
}
.admin-detail__sub {
  margin: 0;
  font-size: 13px;
  color: var(--color-muted);
}
.admin-fields {
  display: grid;
  gap: 0;
  margin: 8px 0 12px;
}
.admin-fields div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
}
.admin-fields dt {
  color: var(--color-muted);
}
.admin-fields dd {
  margin: 0;
  text-align: right;
  color: var(--color-heading);
  overflow-wrap: anywhere;
}
.admin-mono {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
}
.admin-actions {
  display: grid;
  gap: 8px;
}
.admin-error {
  margin: 8px 16px;
  color: var(--color-expense);
  font-size: 13px;
}
.admin-action__submit {
  margin-top: 12px;
  height: var(--page-button-height);
}
</style>

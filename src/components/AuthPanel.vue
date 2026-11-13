<script setup>
// 登入／註冊／忘記密碼。後端有設定寄信服務時，註冊與重設密碼都需要 Email 驗證碼。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { showToast } from 'vant'
import { getAuthConfig, isApiAvailable, requestEmailCode, signIn } from '../services/authSession.js'
import { passwordChecks, passwordPolicyError } from '../domain/password.js'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['update:show', 'signed-in'])

const MIN_PASSWORD = 8
const mode = ref('login') // login | register | forgot
const step = ref('form') // form | code
const email = ref('')
const password = ref('')
const code = ref('')
const showPassword = ref(false)
const busy = ref(false)
const error = ref('')
const errorAction = ref(null) // { label, run }
const emailVerification = ref(false)
const resendIn = ref(0)
let timer = null

watch(
  () => props.show,
  async (show) => {
    if (!show) return
    error.value = ''
    const config = await getAuthConfig()
    emailVerification.value = Boolean(config?.emailVerification)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearInterval(timer))

const titles = { login: '登入帳號', register: '建立帳號', forgot: '重設密碼' }
const title = computed(() => titles[mode.value])
const needsCode = computed(() => mode.value === 'forgot' || (mode.value === 'register' && emailVerification.value))
const trimmedEmail = computed(() => email.value.trim())
const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail.value))
// 註冊與重設密碼時逐項顯示密碼規則；登入不套用，舊帳號才能繼續登入
const checks = computed(() => passwordChecks(password.value))
const showChecks = computed(() => mode.value !== 'login' && Boolean(password.value))

function switchMode(next) {
  mode.value = next
  step.value = 'form'
  code.value = ''
  error.value = ''
  errorAction.value = null
  if (next === 'forgot') password.value = ''
}

function startCountdown(seconds) {
  clearInterval(timer)
  resendIn.value = seconds
  timer = setInterval(() => {
    resendIn.value -= 1
    if (resendIn.value <= 0) clearInterval(timer)
  }, 1000)
}

function fail(message, action = null) {
  error.value = message
  errorAction.value = action
}

async function sendCode() {
  if (!emailValid.value) return fail('請輸入有效的 Email')
  if (mode.value === 'register' && passwordPolicyError(password.value)) {
    return fail(passwordPolicyError(password.value))
  }
  busy.value = true
  error.value = ''
  try {
    const result = await requestEmailCode(trimmedEmail.value, mode.value === 'register' ? 'REGISTER' : 'RESET_PASSWORD')
    step.value = 'code'
    code.value = ''
    startCountdown(result?.resendAfterSeconds ?? 60)
    showToast('驗證碼已寄出')
  } catch (err) {
    const message = err.message || '寄送失敗'
    fail(message, message.includes('已經註冊過') ? { label: '改為登入', run: () => switchMode('login') } : null)
  } finally {
    busy.value = false
  }
}

async function submit() {
  if (busy.value) return
  error.value = ''
  errorAction.value = null
  if (needsCode.value && step.value === 'form') return sendCode()
  if (!emailValid.value) return fail('請輸入有效的 Email')
  if (mode.value !== 'login' && passwordPolicyError(password.value)) {
    return fail(passwordPolicyError(password.value))
  }
  if (needsCode.value && !/^\d{6}$/.test(code.value.trim())) return fail('請輸入信中的 6 位數驗證碼')
  busy.value = true
  try {
    const apiMode = mode.value === 'forgot' ? 'reset-password' : mode.value
    await signIn(apiMode, trimmedEmail.value, password.value, needsCode.value ? code.value.trim() : undefined)
    if (mode.value === 'forgot') showToast('密碼已更新，已為你登入')
    else if (mode.value === 'register') showToast('註冊完成，歡迎加入')
    password.value = ''
    code.value = ''
    step.value = 'form'
    mode.value = 'login'
    emit('update:show', false)
    emit('signed-in')
  } catch (err) {
    const message = err.message || '操作失敗'
    if (mode.value === 'login' && message.includes('不正確')) {
      fail(
        'Email 或密碼不正確。',
        emailVerification.value ? { label: '忘記密碼？用 Email 重設', run: () => switchMode('forgot') } : null,
      )
    } else if (message.includes('已經註冊過')) {
      fail(message, { label: '改為登入', run: () => switchMode('login') })
    } else {
      fail(message)
    }
  } finally {
    busy.value = false
  }
}

const primaryLabel = computed(() => {
  if (mode.value === 'login') return '登入'
  if (needsCode.value && step.value === 'form') return '寄送驗證碼'
  return mode.value === 'register' ? '完成註冊' : '重設密碼並登入'
})
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    safe-area-inset-bottom
    @update:show="emit('update:show', $event)"
  >
    <form class="auth-sheet" novalidate @submit.prevent="submit">
      <div class="auth-sheet__header">
        <button
          v-if="mode !== 'login'"
          type="button"
          class="auth-sheet__back"
          aria-label="返回登入"
          @click="step === 'code' ? (step = 'form') : switchMode('login')"
        >
          <van-icon name="arrow-left" />
        </button>
        <h2>{{ title }}</h2>
        <button type="button" aria-label="關閉" @click="emit('update:show', false)">
          <van-icon name="cross" />
        </button>
      </div>

      <p v-if="mode === 'login'">登入後資料會存到雲端，換手機也不會不見。</p>
      <p v-else-if="mode === 'register' && step === 'form'">
        {{ emailVerification ? '我們會寄驗證碼到你的信箱。' : '登入後資料會存到雲端，換手機也不會不見。' }}
      </p>
      <p v-else-if="mode === 'forgot' && step === 'form'">輸入註冊的 Email，我們會寄驗證碼給你。</p>
      <p v-if="!isApiAvailable" class="auth-sheet__warning">此原生版本尚未設定 HTTPS API 位址，暫時無法登入。</p>

      <template v-if="step === 'form'">
        <van-field
          v-model="email"
          label="Email"
          type="email"
          inputmode="email"
          autocomplete="email"
          placeholder="you@example.com"
          :disabled="busy"
        />
        <van-field
          v-if="mode !== 'forgot'"
          v-model="password"
          label="密碼"
          :type="showPassword ? 'text' : 'password'"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          :placeholder="mode === 'login' ? '' : `至少 ${MIN_PASSWORD} 個字元，含大小寫、數字、符號`"
          :right-icon="showPassword ? 'eye-o' : 'closed-eye'"
          :disabled="busy"
          @click-right-icon="showPassword = !showPassword"
        />
        <ul v-if="showChecks" class="auth-sheet__rules" aria-label="密碼規則">
          <li v-for="check in checks" :key="check.key" :class="{ 'is-ok': check.ok }">
            <van-icon :name="check.ok ? 'success' : 'circle'" />{{ check.label }}
          </li>
        </ul>
      </template>

      <template v-else>
        <div class="auth-sheet__sent">
          <van-icon name="envelop-o" aria-hidden="true" />
          <span>
            驗證碼已寄到 <strong>{{ trimmedEmail }}</strong>
            <small>10 分鐘內有效，沒收到請看垃圾郵件。</small>
          </span>
        </div>
        <label class="auth-sheet__code">
          <span>6 位數驗證碼</span>
          <input
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="••••••"
            aria-label="6 位數驗證碼"
            @input="code = code.replace(/\D/g, '').slice(0, 6)"
          />
        </label>
        <van-field
          v-if="mode === 'forgot'"
          v-model="password"
          label="新密碼"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="new-password"
          :placeholder="`至少 ${MIN_PASSWORD} 個字元，含大小寫、數字、符號`"
          :right-icon="showPassword ? 'eye-o' : 'closed-eye'"
          @click-right-icon="showPassword = !showPassword"
        />
        <ul v-if="mode === 'forgot' && showChecks" class="auth-sheet__rules" aria-label="密碼規則">
          <li v-for="check in checks" :key="check.key" :class="{ 'is-ok': check.ok }">
            <van-icon :name="check.ok ? 'success' : 'circle'" />{{ check.label }}
          </li>
        </ul>
        <button type="button" class="auth-sheet__resend" :disabled="resendIn > 0 || busy" @click="sendCode">
          {{ resendIn > 0 ? `${resendIn} 秒後可重新寄送` : '重新寄送驗證碼' }}
        </button>
      </template>

      <div v-if="error" class="auth-sheet__error" role="alert">
        <van-icon name="warning-o" aria-hidden="true" />
        <span>
          {{ error }}
          <button v-if="errorAction" type="button" @click="errorAction.run()">{{ errorAction.label }}</button>
        </span>
      </div>

      <van-button block type="primary" native-type="submit" :disabled="!isApiAvailable || busy" :loading="busy">
        {{ primaryLabel }}
      </van-button>

      <div class="auth-sheet__links">
        <template v-if="mode === 'login'">
          <button type="button" class="auth-sheet__switch" @click="switchMode('register')">沒有帳號？註冊</button>
          <button v-if="emailVerification" type="button" class="auth-sheet__link" @click="switchMode('forgot')">忘記密碼？</button>
        </template>
        <button v-else type="button" class="auth-sheet__switch" @click="switchMode('login')">已有帳號？登入</button>
      </div>
    </form>
  </van-popup>
</template>

<style scoped>
.auth-sheet {
  display: grid;
  gap: 12px;
  max-height: min(86dvh, 720px);
  overflow-y: auto;
  padding: 20px var(--page-horizontal-padding, 18px) calc(24px + env(safe-area-inset-bottom));
  background: #fff;
}
.auth-sheet__header {
  display: flex;
  align-items: center;
  gap: 4px;
}
.auth-sheet__header h2 {
  flex: 1;
  margin: 0;
  color: #1b2a3b;
  font-size: 20px;
}
.auth-sheet__header button {
  width: 40px;
  height: 40px;
  border: 0;
  background: transparent;
  color: #657588;
  font-size: 18px;
}
.auth-sheet__header .auth-sheet__back {
  margin-left: -10px;
  color: #1b2a3b;
}
.auth-sheet p,
.auth-sheet small {
  margin: 0;
  color: #657588;
  font-size: 13px;
  line-height: 1.5;
}
.auth-sheet .auth-sheet__warning {
  color: #b45309;
}
.auth-sheet :deep(.van-button) {
  min-height: 44px;
  border-radius: 12px;
}
.auth-sheet__sent {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #eef5fe;
  color: #1b2a3b;
  font-size: 14px;
  line-height: 1.5;
}
.auth-sheet__sent .van-icon {
  flex: none;
  margin-top: 2px;
  color: #1268da;
  font-size: 20px;
}
.auth-sheet__sent strong {
  overflow-wrap: anywhere;
}
.auth-sheet__sent small {
  display: block;
}
.auth-sheet__code {
  display: grid;
  gap: 6px;
  color: #1b2a3b;
  font-size: 14px;
  font-weight: 700;
}
.auth-sheet__code input {
  width: 100%;
  min-height: 56px;
  box-sizing: border-box;
  border: 1.5px solid #d6dee8;
  border-radius: 12px;
  color: #1b2a3b;
  font: inherit;
  font-size: 28px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.4em;
  text-align: center;
}
.auth-sheet__code input:focus {
  border-color: #1268da;
  outline: none;
}
.auth-sheet__resend {
  justify-self: start;
  min-height: 40px;
  padding: 0;
  border: 0;
  background: none;
  color: #1268da;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.auth-sheet__resend:disabled {
  color: #9aa7b6;
}
.auth-sheet__error {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fdecec;
  color: #b42318;
  font-size: 13px;
  line-height: 1.5;
}
.auth-sheet__error .van-icon {
  flex: none;
  margin-top: 2px;
}
.auth-sheet__error button {
  display: inline;
  margin-left: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: #1268da;
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
}
.auth-sheet__links {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.auth-sheet__switch,
.auth-sheet__link {
  min-height: 40px;
  border: 0;
  background: transparent;
  color: #166dd1;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.auth-sheet__link {
  color: #657588;
}
.auth-sheet__rules {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: #8a97a6;
  font-size: 13px;
}
.auth-sheet__rules li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.auth-sheet__rules li.is-ok {
  color: #15803d;
}
</style>

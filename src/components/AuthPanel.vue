<script setup>
import { ref } from 'vue'
import { showToast } from 'vant'
import { isApiAvailable, signIn } from '../services/authSession.js'

defineProps({ show: Boolean })
const emit = defineEmits(['update:show', 'signed-in'])
const mode = ref('login')
const email = ref('')
const password = ref('')
const busy = ref(false)

async function submit() {
  if (busy.value) return
  if (mode.value === 'register' && password.value.length < 12) {
    showToast('註冊密碼至少需要 12 個字元')
    return
  }
  busy.value = true
  try {
    await signIn(mode.value, email.value.trim(), password.value)
    password.value = ''
    emit('update:show', false)
    emit('signed-in')
  } catch (error) {
    showToast(error.message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    safe-area-inset-bottom
    @update:show="emit('update:show', $event)"
  >
    <form class="auth-sheet" @submit.prevent="submit">
      <div class="auth-sheet__header">
        <h2>{{ mode === 'login' ? '登入帳號' : '建立帳號' }}</h2>
        <button type="button" aria-label="關閉" @click="emit('update:show', false)">
          <van-icon name="cross" />
        </button>
      </div>
      <p>訪客試算仍可使用；登入後才能將私人紀錄存到資料庫。</p>
      <p v-if="!isApiAvailable" class="auth-sheet__warning">
        此原生版本尚未設定 HTTPS API 位址，暫時無法登入。
      </p>
      <van-field v-model="email" label="Email" type="email" autocomplete="email" required />
      <van-field
        v-model="password"
        label="密碼"
        type="password"
        :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
        required
      />
      <small v-if="mode === 'register'"
        >請使用至少 12 個字元；本版尚無 Email 驗證與忘記密碼。</small
      >
      <van-button
        block
        type="primary"
        native-type="submit"
        :disabled="!isApiAvailable || busy"
        :loading="busy"
        >{{ mode === 'login' ? '登入' : '註冊' }}</van-button
      >
      <button
        class="auth-sheet__switch"
        type="button"
        @click="mode = mode === 'login' ? 'register' : 'login'"
      >
        {{ mode === 'login' ? '沒有帳號？註冊' : '已有帳號？登入' }}
      </button>
    </form>
  </van-popup>
</template>

<style scoped>
.auth-sheet {
  display: grid;
  gap: 12px;
  max-height: min(80dvh, 680px);
  overflow-y: auto;
  padding: 20px var(--page-horizontal-padding, 18px) calc(24px + env(safe-area-inset-bottom));
  background: #fff;
}
.auth-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.auth-sheet__header h2 {
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
.auth-sheet__switch {
  min-height: 40px;
  border: 0;
  background: transparent;
  color: #166dd1;
  font-weight: 700;
}
</style>

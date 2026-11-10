<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { accountRepository } from '../repositories/accountRepository.js'
import { passwordChecks } from '../domain/password.js'
import {
  NICKNAME_MAX_LENGTH,
  deleteAccountError,
  formatRegisteredDate,
  nicknameError,
  normalizeNickname,
  passwordChangeError,
} from '../domain/account.js'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['update:show', 'sign-out', 'profile-updated', 'account-deleted'])

const account = ref(null)
const loading = ref(false)
const loadError = ref('')
const nickname = ref('')
const savingNickname = ref(false)
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const changingPassword = ref(false)
const deletePassword = ref('')
const deleting = ref(false)
const checks = computed(() => passwordChecks(passwordForm.newPassword))
const nicknameChanged = computed(
  () => normalizeNickname(nickname.value) !== (account.value?.nickname || ''),
)

function resetPasswordForm() {
  passwordForm.currentPassword = ''
  passwordForm.newPassword = ''
  passwordForm.confirmPassword = ''
  deletePassword.value = ''
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    account.value = await accountRepository.get()
    nickname.value = account.value.nickname || ''
  } catch (error) {
    loadError.value = error.message
  } finally {
    loading.value = false
  }
}

// 每次開啟重新讀取；關閉時清掉密碼欄位，避免殘留在記憶體畫面上
watch(
  () => props.show,
  (open) => {
    if (open) load()
    else resetPasswordForm()
  },
  { immediate: true },
)

async function saveNickname() {
  const error = nicknameError(nickname.value)
  if (error) return showToast(error)
  savingNickname.value = true
  try {
    account.value = await accountRepository.saveNickname(nickname.value)
    nickname.value = account.value.nickname || ''
    emit('profile-updated', account.value)
    showToast('顯示名稱已更新')
  } catch (error) {
    showToast(error.message)
  } finally {
    savingNickname.value = false
  }
}

async function changePassword() {
  const error = passwordChangeError(passwordForm)
  if (error) return showToast(error)
  changingPassword.value = true
  try {
    await accountRepository.changePassword(passwordForm.currentPassword, passwordForm.newPassword)
    resetPasswordForm()
    showToast('密碼已更新，其他裝置的登入已登出')
  } catch (error) {
    showToast(error.message)
  } finally {
    changingPassword.value = false
  }
}

async function deleteAccount() {
  const error = deleteAccountError(deletePassword.value)
  if (error) return showToast(error)
  try {
    await showConfirmDialog({
      title: '確定刪除帳號？',
      message: '將永久刪除此帳號與所有班表、薪資入帳、車資、支出、採買、禁休與設定，無法復原。',
      confirmButtonText: '永久刪除',
      confirmButtonColor: '#ee0a24',
    })
  } catch {
    return // 使用者取消
  }
  deleting.value = true
  try {
    await accountRepository.deleteAccount(deletePassword.value)
    deletePassword.value = ''
    emit('account-deleted')
  } catch (error) {
    showToast(error.message)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    safe-area-inset-bottom
    class="account-popup"
    @update:show="emit('update:show', $event)"
  >
    <div class="account-page">
      <div class="account-page__header">
        <h2>會員資料</h2>
        <button type="button" aria-label="關閉" @click="emit('update:show', false)">
          <van-icon name="cross" />
        </button>
      </div>

      <van-loading v-if="loading && !account" class="account-page__loading" size="24px"
        >讀取中…</van-loading
      >
      <div v-else-if="loadError && !account" class="account-card-block">
        <p class="account-page__error">{{ loadError }}</p>
        <van-button block plain type="primary" @click="load">重試</van-button>
      </div>

      <template v-if="account">
        <section class="account-card-block" aria-labelledby="account-profile-title">
          <h3 id="account-profile-title">基本資料</h3>
          <dl class="account-page__facts">
            <div>
              <dt>Email</dt>
              <dd :title="account.email">{{ account.email }}</dd>
            </div>
            <div>
              <dt>註冊日期</dt>
              <dd>{{ formatRegisteredDate(account.createdAt) }}</dd>
            </div>
          </dl>
          <form class="account-page__form" @submit.prevent="saveNickname">
            <van-field
              v-model="nickname"
              label="顯示名稱"
              placeholder="選填"
              :maxlength="NICKNAME_MAX_LENGTH"
              autocomplete="nickname"
            />
            <van-button
              block
              plain
              type="primary"
              native-type="submit"
              :disabled="!nicknameChanged || savingNickname"
              :loading="savingNickname"
              >儲存顯示名稱</van-button
            >
          </form>
        </section>

        <section class="account-card-block" aria-labelledby="account-password-title">
          <h3 id="account-password-title">修改密碼</h3>
          <form class="account-page__form" @submit.prevent="changePassword">
            <!-- 讓瀏覽器密碼管理員對應到正確帳號 -->
            <input
              class="account-page__username"
              type="email"
              autocomplete="username"
              :value="account.email"
              readonly
              tabindex="-1"
              aria-hidden="true"
            />
            <van-field
              v-model="passwordForm.currentPassword"
              label="目前密碼"
              type="password"
              autocomplete="current-password"
              required
            />
            <van-field
              v-model="passwordForm.newPassword"
              label="新密碼"
              type="password"
              autocomplete="new-password"
              required
            />
            <van-field
              v-model="passwordForm.confirmPassword"
              label="確認新密碼"
              type="password"
              autocomplete="new-password"
              required
            />
            <ul class="account-page__rules" aria-label="新密碼規則">
              <li v-for="check in checks" :key="check.key" :class="{ 'is-ok': check.ok }">
                <van-icon :name="check.ok ? 'success' : 'circle'" />{{ check.label }}
              </li>
            </ul>
            <small>更新後，其他裝置上的登入會被登出；這台裝置保持登入。</small>
            <van-button
              block
              type="primary"
              native-type="submit"
              :disabled="changingPassword"
              :loading="changingPassword"
              >更新密碼</van-button
            >
          </form>
        </section>
      </template>

      <van-button block plain type="danger" class="account-page__signout" @click="emit('sign-out')"
        >登出</van-button
      >

      <section
        v-if="account"
        class="account-card-block account-card-block--danger"
        aria-labelledby="account-delete-title"
      >
        <h3 id="account-delete-title">刪除帳號</h3>
        <small
          >永久刪除此帳號與所有已保存的私人資料（班表、薪資入帳、車資、支出、採買、禁休與設定），無法復原。這台裝置上的訪客資料不受影響。</small
        >
        <form class="account-page__form" @submit.prevent="deleteAccount">
          <van-field
            v-model="deletePassword"
            label="密碼"
            type="password"
            autocomplete="current-password"
            placeholder="輸入密碼以確認"
          />
          <van-button
            block
            type="danger"
            native-type="submit"
            :disabled="deleting"
            :loading="deleting"
            >永久刪除帳號</van-button
          >
        </form>
      </section>
      <small class="account-page__note">本版尚無 Email 驗證與忘記密碼。</small>
    </div>
  </van-popup>
</template>

<style scoped>
.account-page {
  display: grid;
  gap: 14px;
  max-height: min(90dvh, 820px);
  overflow-y: auto;
  padding: 20px var(--page-horizontal-padding, 18px) calc(24px + env(safe-area-inset-bottom));
  background: #f5f8fc;
}
.account-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.account-page__header h2 {
  margin: 0;
  color: #1b2a3b;
  font-size: 20px;
}
.account-page__header button {
  width: 40px;
  height: 40px;
  border: 0;
  background: transparent;
  color: #657588;
}
.account-page__loading {
  justify-content: center;
  padding: 24px 0;
}
.account-card-block {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--color-border, #e3ebf5);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(29, 66, 106, 0.05);
}
.account-card-block--danger {
  border-color: #fbd5d5;
}
.account-card-block--danger h3 {
  color: #c81e1e;
}
.account-card-block h3 {
  margin: 0;
  color: #1b2a3b;
  font-size: 16px;
  font-weight: 800;
}
.account-page__facts {
  display: grid;
  gap: 8px;
  margin: 0;
}
.account-page__facts div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.account-page__facts dt {
  flex: none;
  color: #657588;
  font-size: 13px;
}
.account-page__facts dd {
  overflow: hidden;
  margin: 0;
  color: #1b2a3b;
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-page__form {
  display: grid;
  gap: 10px;
}
.account-page__form :deep(.van-field) {
  border-radius: 12px;
  background: #f5f8fc;
}
.account-page__username {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
.account-page__rules {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: #8a97a6;
  font-size: 13px;
}
.account-page__rules li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.account-page__rules li.is-ok {
  color: #15803d;
}
.account-page small,
.account-page__error {
  margin: 0;
  color: #657588;
  font-size: 13px;
  line-height: 1.5;
}
.account-page__error {
  color: #b45309;
}
.account-page :deep(.van-button) {
  min-height: 44px;
  border-radius: 12px;
}
.account-page__note {
  text-align: center;
}
</style>

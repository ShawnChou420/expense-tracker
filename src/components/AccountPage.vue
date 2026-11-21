<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useI18n } from 'vue-i18n'
import { localizeMessage } from '../i18n/messages.js'
import LanguageSwitcher from './LanguageSwitcher.vue'
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
const { t } = useI18n()
const emit = defineEmits([
  'update:show',
  'sign-out',
  'profile-updated',
  'account-deleted',
  'open-privacy',
])

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
  if (error) return showToast(localizeMessage(error))
  savingNickname.value = true
  try {
    account.value = await accountRepository.saveNickname(nickname.value)
    nickname.value = account.value.nickname || ''
    emit('profile-updated', account.value)
    showToast(t('account.nicknameUpdated'))
  } catch (error) {
    showToast(localizeMessage(error.message))
  } finally {
    savingNickname.value = false
  }
}

async function changePassword() {
  const error = passwordChangeError(passwordForm)
  if (error) return showToast(localizeMessage(error))
  changingPassword.value = true
  try {
    await accountRepository.changePassword(passwordForm.currentPassword, passwordForm.newPassword)
    resetPasswordForm()
    showToast(t('account.passwordUpdated'))
  } catch (error) {
    showToast(localizeMessage(error.message))
  } finally {
    changingPassword.value = false
  }
}

async function deleteAccount() {
  const error = deleteAccountError(deletePassword.value)
  if (error) return showToast(localizeMessage(error))
  try {
    await showConfirmDialog({
      title: t('account.deleteConfirmTitle'),
      message: t('account.deleteConfirmMessage'),
      confirmButtonText: t('account.deleteForever'),
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
    showToast(localizeMessage(error.message))
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
        <h2>{{ t('account.profileTitle') }}</h2>
        <button type="button" :aria-label="t('common.close')" @click="emit('update:show', false)">
          <van-icon name="cross" />
        </button>
      </div>

      <van-loading v-if="loading && !account" class="account-page__loading" size="24px"
        >{{ t('account.loadingProfile') }}</van-loading
      >
      <div v-else-if="loadError && !account" class="account-card-block">
        <p class="account-page__error">{{ loadError }}</p>
        <van-button block plain type="primary" @click="load">{{ t('common.retry') }}</van-button>
      </div>

      <template v-if="account">
        <section class="account-card-block" aria-labelledby="account-profile-title">
          <h3 id="account-profile-title">{{ t('account.basicInfo') }}</h3>
          <dl class="account-page__facts">
            <div>
              <dt>Email</dt>
              <dd :title="account.email">{{ account.email }}</dd>
            </div>
            <div>
              <dt>{{ t('account.registeredOn') }}</dt>
              <dd>{{ formatRegisteredDate(account.createdAt) }}</dd>
            </div>
          </dl>
          <form class="account-page__form" @submit.prevent="saveNickname">
            <van-field
              v-model="nickname"
              :label="t('account.displayName')"
              :placeholder="t('common.optional')"
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
              >{{ t('account.saveDisplayName') }}</van-button
            >
          </form>
        </section>

        <section class="account-card-block" aria-labelledby="account-password-title">
          <h3 id="account-password-title">{{ t('account.changePassword') }}</h3>
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
              :label="t('account.currentPassword')"
              type="password"
              autocomplete="current-password"
              required
            />
            <van-field
              v-model="passwordForm.newPassword"
              :label="t('account.newPassword')"
              type="password"
              autocomplete="new-password"
              required
            />
            <van-field
              v-model="passwordForm.confirmPassword"
              :label="t('account.confirmNewPassword')"
              type="password"
              autocomplete="new-password"
              required
            />
            <ul class="account-page__rules" :aria-label="t('account.newPasswordRules')">
              <li v-for="check in checks" :key="check.key" :class="{ 'is-ok': check.ok }">
                <van-icon :name="check.ok ? 'success' : 'circle'" />{{ t(`passwordRules.${check.key}`) }}
              </li>
            </ul>
            <small>{{ t('account.passwordChangeNote') }}</small>
            <van-button
              block
              type="primary"
              native-type="submit"
              :disabled="changingPassword"
              :loading="changingPassword"
              >{{ t('account.updatePassword') }}</van-button
            >
          </form>
        </section>
      </template>

      <section class="account-card-block" aria-labelledby="account-language-title">
        <h3 id="account-language-title">{{ t('language.label') }}</h3>
        <van-cell-group class="account-page__language">
          <LanguageSwitcher variant="cell" />
        </van-cell-group>
        <small>{{ t('language.hint') }}</small>
      </section>

      <van-button block plain type="danger" class="account-page__signout" @click="emit('sign-out')"
        >{{ t('account.logout') }}</van-button
      >

      <section
        v-if="account"
        class="account-card-block account-card-block--danger"
        aria-labelledby="account-delete-title"
      >
        <h3 id="account-delete-title">{{ t('account.deleteAccount') }}</h3>
        <small
          >{{ t('account.deleteWarning') }}</small
        >
        <form class="account-page__form" @submit.prevent="deleteAccount">
          <van-field
            v-model="deletePassword"
            :label="t('account.password')"
            type="password"
            autocomplete="current-password"
            :placeholder="t('account.passwordToConfirm')"
          />
          <van-button
            block
            type="danger"
            native-type="submit"
            :disabled="deleting"
            :loading="deleting"
            >{{ t('account.deleteAccountForever') }}</van-button
          >
        </form>
      </section>
      <button type="button" class="account-page__privacy" @click="emit('open-privacy')">
        {{ t('more.privacy') }}
      </button>
    </div>
  </van-popup>
</template>

<style scoped>
.account-page__language {
  margin: 4px 0 6px;
  overflow: hidden;
  border-radius: 8px;
}
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
.account-page__privacy {
  justify-self: center;
  min-height: 40px;
  border: 0;
  background: transparent;
  color: #166dd1;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.account-page__note {
  text-align: center;
}
</style>

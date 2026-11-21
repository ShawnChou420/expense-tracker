<script setup>
// 「更多」：放採買清單等延伸功能，讓底部分頁專注在收支。只列出已經能用的功能。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LanguageSwitcher from './LanguageSwitcher.vue'
import { CONTACT_EMAIL, FEEDBACK_URL } from '../config/beta.js'
import { isSuperAdmin } from '../services/authSession.js'

const emit = defineEmits(['navigate'])
const { t } = useI18n()

const baseTools = computed(() => [
  {
    name: 'work-setup',
    icon: 'setting-o',
    title: t('more.workSetup'),
    description: t('more.workSetupDescription'),
  },
  {
    name: 'payslip',
    icon: 'description-o',
    title: t('more.importPayslip'),
    description: t('more.importPayslipDescription'),
  },
  {
    name: 'visa',
    icon: 'flag-o',
    title: t('more.visaTracker'),
    description: t('more.visaDescription'),
  },
  {
    name: 'shopping',
    icon: 'cart-o',
    title: t('more.shoppingTitle'),
    description: t('more.shoppingDescription'),
  },
  {
    name: 'privacy',
    icon: 'shield-o',
    title: t('more.privacy'),
    description: t('more.privacyDescription'),
  },
])


// 管理後台入口只在 SUPER_ADMIN 登入時顯示；後端每個管理 API 仍會重新驗證權限
const tools = computed(() => [
  ...(isSuperAdmin.value
    ? [{ name: 'admin', icon: 'manager-o', title: t('more.admin'), description: t('more.adminDescription') }]
    : []),
  ...baseTools.value,
])
</script>

<template>
  <main class="more-page app-page">
    <header class="app-page__header">
      <div>
        <h1>{{ t('more.title') }}</h1>
        <p>{{ t('more.subtitle') }}</p>
      </div>
    </header>

    <section class="more-group">
      <h2>{{ t('more.tools') }}</h2>
      <button
        v-for="tool in tools"
        :key="tool.name"
        type="button"
        class="more-item app-page__card"
        @click="emit('navigate', tool.name)"
      >
        <span class="more-item__icon" aria-hidden="true"><van-icon :name="tool.icon" /></span>
        <span class="more-item__text">
          <strong>{{ tool.title }}</strong>
          <small>{{ tool.description }}</small>
        </span>
        <van-icon name="arrow" class="more-item__arrow" aria-hidden="true" />
      </button>
      <!-- 回饋與聯絡：src/config/beta.js 有填才顯示 -->
      <a
        v-if="FEEDBACK_URL"
        :href="FEEDBACK_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="more-item app-page__card"
      >
        <span class="more-item__icon" aria-hidden="true"><van-icon name="chat-o" /></span>
        <span class="more-item__text">
          <strong>{{ t('more.feedback') }}</strong>
          <small>{{ t('more.feedbackDescription') }}</small>
        </span>
        <van-icon name="arrow" class="more-item__arrow" aria-hidden="true" />
      </a>
      <a v-if="CONTACT_EMAIL" :href="`mailto:${CONTACT_EMAIL}`" class="more-item app-page__card">
        <span class="more-item__icon" aria-hidden="true"><van-icon name="envelop-o" /></span>
        <span class="more-item__text">
          <strong>{{ t('more.contact') }}</strong>
          <small>{{ CONTACT_EMAIL }}</small>
        </span>
        <van-icon name="arrow" class="more-item__arrow" aria-hidden="true" />
      </a>
    </section>

    <section class="more-group">
      <h2>{{ t('more.languageSettings') }}</h2>
      <van-cell-group inset class="more-language">
        <LanguageSwitcher variant="cell" />
      </van-cell-group>
      <p class="more-language__hint">{{ t('language.hint') }}</p>
    </section>
  </main>
</template>

<style scoped>
.more-language {
  margin: 0;
}
.more-language__hint {
  margin: 8px 2px 0;
  color: var(--color-muted, #6b7280);
  font-size: 12px;
}
.more-group {
  margin-top: var(--page-section-gap);
}
.more-group h2 {
  margin: 0 2px 10px;
  color: var(--color-heading);
  font-size: var(--font-heading);
  font-weight: 800;
}
.more-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin: 0 0 10px;
  padding: 14px;
  border: 1px solid var(--color-border);
  color: inherit;
  font: inherit;
  text-align: left;
}
a.more-item {
  color: inherit;
  text-decoration: none;
}
button.more-item,
a.more-item {
  cursor: pointer;
}
.more-item__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 13px;
  background: #eaf3fe;
  color: #166dd1;
  font-size: 22px;
}
.more-item__text {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}
.more-item__text strong {
  color: var(--color-heading);
  font-size: 15px;
}
.more-item__text small {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}
.more-item__arrow {
  flex: none;
  color: #a7b4c2;
}
</style>

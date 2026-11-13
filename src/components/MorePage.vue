<script setup>
// 「更多」：放採買清單等延伸功能，讓底部分頁專注在收支。只列出已經能用的功能。
import { CONTACT_EMAIL, FEEDBACK_URL } from '../config/beta.js'

const emit = defineEmits(['navigate'])

const tools = [
  {
    name: 'work-setup',
    icon: 'setting-o',
    title: '工作設定',
    description: '時薪、班別與 Smoko',
  },
  {
    name: 'payslip',
    icon: 'description-o',
    title: '匯入薪資單',
    description: '上傳 PDF 自動設定時薪與加給',
  },
  {
    name: 'shopping',
    icon: 'cart-o',
    title: '採買清單',
    description: '這次／下次要買的東西，買完打勾',
  },
  {
    name: 'privacy',
    icon: 'shield-o',
    title: '隱私說明',
    description: '保存哪些資料、怎麼刪除',
  },
]

</script>

<template>
  <main class="more-page app-page">
    <header class="app-page__header">
      <div>
        <h1>更多</h1>
        <p>工作設定、薪資單與採買清單</p>
      </div>
    </header>

    <section class="more-group">
      <h2>工具</h2>
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
          <strong>意見回饋</strong>
          <small>遇到問題或有想法，告訴我們</small>
        </span>
        <van-icon name="arrow" class="more-item__arrow" aria-hidden="true" />
      </a>
      <a v-if="CONTACT_EMAIL" :href="`mailto:${CONTACT_EMAIL}`" class="more-item app-page__card">
        <span class="more-item__icon" aria-hidden="true"><van-icon name="envelop-o" /></span>
        <span class="more-item__text">
          <strong>聯絡我們</strong>
          <small>{{ CONTACT_EMAIL }}</small>
        </span>
        <van-icon name="arrow" class="more-item__arrow" aria-hidden="true" />
      </a>
    </section>

  </main>
</template>

<style scoped>
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

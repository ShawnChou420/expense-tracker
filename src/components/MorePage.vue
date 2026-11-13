<script setup>
// 「更多」：放採買清單等延伸功能，以及規劃中的模組，讓底部分頁專注在收支。
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
    description: '和室友共用，買完直接記成支出',
  },
]

const upcoming = [
  { icon: 'balance-list-o', title: '稅務追蹤', description: '年度級距與預估稅額' },
  { icon: 'description-o', title: '薪資單核對', description: '比對薪資單與班表預估的差額' },
  { icon: 'medal-o', title: '儲蓄成就', description: '每週存款目標、連續達標與徽章' },
]
</script>

<template>
  <main class="more-page app-page">
    <header class="app-page__header">
      <div>
        <h1>更多</h1>
        <p>延伸工具與即將推出的功能</p>
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
    </section>

    <section class="more-group">
      <h2>規劃中</h2>
      <div
        v-for="item in upcoming"
        :key="item.title"
        class="more-item more-item--disabled app-page__card"
      >
        <span class="more-item__icon" aria-hidden="true"><van-icon :name="item.icon" /></span>
        <span class="more-item__text">
          <strong>{{ item.title }}</strong>
          <small>{{ item.description }}</small>
        </span>
        <span class="more-item__badge">規劃中</span>
      </div>
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
button.more-item {
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
.more-item--disabled {
  opacity: 0.7;
}
.more-item--disabled .more-item__icon {
  background: #f1f5f9;
  color: #7b8a9a;
}
.more-item__badge {
  flex: none;
  padding: 3px 8px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #657588;
  font-size: 11px;
  font-weight: 700;
}
</style>

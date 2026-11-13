<script setup>
// 隱私說明：寫實際的做法，不寫還沒做的事。內容變更時要更新 PRIVACY_UPDATED。
import { CONTACT_EMAIL, FEEDBACK_URL, PRIVACY_UPDATED } from '../config/beta.js'

defineProps({ show: Boolean })
const emit = defineEmits(['update:show'])
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    safe-area-inset-bottom
    @update:show="emit('update:show', $event)"
  >
    <article class="privacy">
      <header class="privacy__header">
        <div>
          <h2>隱私說明</h2>
          <small>最後更新 {{ PRIVACY_UPDATED }}・封閉測試版</small>
        </div>
        <button type="button" aria-label="關閉" @click="emit('update:show', false)">
          <van-icon name="cross" />
        </button>
      </header>

      <section>
        <h3>保存哪些資料</h3>
        <ul>
          <li>Email，以及加密後的密碼（伺服器不保存密碼原文）。</li>
          <li>你自己輸入的班表、薪資設定、薪資入帳、支出、車資、採買清單、禁休與存款目標。</li>
          <li>匯入薪資單時，只保存你確認過的數字（日期、金額、費率）。PDF 檔與 PDF 密碼只在你的裝置上讀取，不會上傳。</li>
          <li>沒有登入（訪客模式）時，資料只在這個頁面的記憶體裡，重新整理就會消失，不會送到伺服器。</li>
        </ul>
      </section>

      <section>
        <h3>存在哪裡、誰看得到</h3>
        <ul>
          <li>後端放在 Render，資料庫放在 Neon，機房都在新加坡。</li>
          <li>每個帳號只能讀寫自己的資料。</li>
          <li>開發者為了維護和備份，可以存取資料庫，但不會拿你的內容做其他用途。</li>
          <li>不賣、不分享資料，沒有廣告，也沒有第三方追蹤或分析工具。</li>
          <li>匯率資料由 open.er-api.com 提供，只會送出要查詢的幣別。</li>
        </ul>
      </section>

      <section>
        <h3>登入狀態</h3>
        <ul>
          <li>登入後會記住這台裝置，30 天沒使用才需要重新登入。</li>
          <li>用別人的手機或公用電腦時，用完請到「帳號」登出。</li>
          <li>修改密碼後，其他裝置會自動登出。</li>
        </ul>
      </section>

      <section>
        <h3>刪除資料</h3>
        <ul>
          <li>登入後打開「帳號」，在最下面的「刪除帳號」輸入密碼，就會立即永久刪除帳號和所有資料，無法復原。</li>
          <li>開發者手動匯出的備份檔可能還有刪除前的資料，備份檔會定期輪替刪除。</li>
        </ul>
      </section>

      <section>
        <h3>測試版提醒</h3>
        <ul>
          <li>薪資、稅額都是依你輸入的資料估算，實際以薪資單和 ATO 為準。</li>
          <li>測試期間功能可能調整，重要資料請自己另外留存。</li>
        </ul>
      </section>

      <section v-if="CONTACT_EMAIL || FEEDBACK_URL">
        <h3>聯絡</h3>
        <ul>
          <li v-if="CONTACT_EMAIL">
            Email：<a :href="`mailto:${CONTACT_EMAIL}`">{{ CONTACT_EMAIL }}</a>
          </li>
          <li v-if="FEEDBACK_URL">
            <a :href="FEEDBACK_URL" target="_blank" rel="noopener noreferrer">填寫意見回饋</a>
          </li>
        </ul>
      </section>
    </article>
  </van-popup>
</template>

<style scoped>
.privacy {
  display: grid;
  gap: 16px;
  max-height: min(88dvh, 820px);
  overflow-y: auto;
  padding: 20px var(--page-horizontal-padding, 18px) calc(24px + env(safe-area-inset-bottom));
  background: #fff;
  color: #1b2a3b;
}
.privacy__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.privacy__header h2 {
  margin: 0;
  font-size: 20px;
}
.privacy__header small {
  color: #657588;
  font-size: 12px;
}
.privacy__header button {
  flex: none;
  width: 40px;
  height: 40px;
  border: 0;
  background: transparent;
  color: #657588;
}
.privacy h3 {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 800;
}
.privacy ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
  color: #3d4b5c;
  font-size: 14px;
  line-height: 1.55;
}
.privacy a {
  color: #166dd1;
  font-weight: 700;
}
</style>

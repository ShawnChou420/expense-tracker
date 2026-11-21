<script setup>
import { onMounted, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { formatAud } from '../domain/money.js'
import { supermarketRepository } from '../repositories/supermarketRepository.js'

/**
 * 管理員匯入 Woolworths 本週特價 CSV。先預覽（dryRun，不寫資料庫），確認後才正式匯入。
 * Woolworths 網站條款禁止以 robot／spider 擷取，所以資料由管理員手動整理成 CSV。
 */
const TEMPLATE =
  'external_product_id,name,brand,package_size,category,regular_price,sale_price,unit_price,promotion_type,promotion_start,promotion_end,product_url'
const STATUS_LABELS = { SUCCESS: '成功', PARTIAL: '部分成功', FAILED: '失敗' }
const MAX_BYTES = 200 * 1024

const csv = ref('')
const fileName = ref('')
const regionCode = ref('NSW')
const sourceReference = ref('')
const preview = ref(null)
const busy = ref(false)
const runs = ref([])

async function loadRuns() {
  try {
    runs.value = await supermarketRepository.importRuns()
  } catch (error) {
    showToast(error.message || '無法讀取匯入紀錄')
  }
}
onMounted(loadRuns)

async function onFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (file.size > MAX_BYTES) {
    showToast('檔案太大（上限 200 KB），請分批匯入')
    return
  }
  csv.value = await file.text()
  fileName.value = file.name
  if (!sourceReference.value) sourceReference.value = file.name.slice(0, 200)
  preview.value = null
}

function body(dryRun) {
  return {
    csv: csv.value,
    regionCode: regionCode.value.trim() || 'NSW',
    sourceReference: sourceReference.value.trim(),
    dryRun,
  }
}

async function runPreview() {
  if (busy.value || !csv.value.trim()) return
  busy.value = true
  try {
    preview.value = await supermarketRepository.importCsv(body(true))
  } catch (error) {
    showToast(error.message || '預覽失敗')
  } finally {
    busy.value = false
  }
}

async function runImport() {
  if (busy.value || !preview.value?.validCount) return
  try {
    await showConfirmDialog({
      title: '正式匯入？',
      message: `會寫入 ${preview.value.validCount} 筆特價（${preview.value.regionCode}）。同一商品同一期會更新價格，舊的各期保留為價格歷史。`,
      confirmButtonText: '匯入',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    const result = await supermarketRepository.importCsv(body(false))
    showToast(`匯入${STATUS_LABELS[result.status] || result.status}：${result.importedCount} 筆`)
    preview.value = null
    csv.value = ''
    fileName.value = ''
    sourceReference.value = ''
    await loadRuns()
  } catch (error) {
    showToast(error.message || '匯入失敗')
  } finally {
    busy.value = false
  }
}

function formatTime(iso) {
  return iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '—'
}
</script>

<template>
  <div class="specials-import">
    <p class="specials-import__intro">
      Woolworths 網站條款禁止自動擷取，請手動整理成 CSV 後匯入。價格用「元」填（例如 4.50）， 日期用
      YYYY-MM-DD；沒有的欄位留空。第一列必須是欄位名稱：
    </p>
    <code class="specials-import__template">{{ TEMPLATE }}</code>

    <label class="specials-import__file">
      <input type="file" accept=".csv,text/csv" @change="onFile" />
      <span>{{ fileName || '選擇 CSV 檔案' }}</span>
    </label>
    <van-field v-model="regionCode" label="地區代碼" placeholder="NSW 或 NSW-2000" maxlength="8" />
    <van-field
      v-model="sourceReference"
      label="來源備註"
      placeholder="例如 2026-11-26 型錄"
      maxlength="200"
    />
    <van-button
      block
      plain
      type="primary"
      :loading="busy && !preview"
      :disabled="busy || !csv.trim()"
      @click="runPreview"
      >預覽（不寫入）</van-button
    >

    <div v-if="preview" class="specials-import__preview" role="status">
      <p>
        共 {{ preview.rowCount }} 列：可匯入 <strong>{{ preview.validCount }}</strong> 筆，錯誤
        <strong :class="{ 'is-alert': preview.errorCount }">{{ preview.errorCount }}</strong> 筆
      </p>
      <ul v-if="preview.errors.length" class="specials-import__errors">
        <li v-for="message in preview.errors" :key="message">{{ message }}</li>
      </ul>
      <ul v-if="preview.preview?.length" class="specials-import__rows">
        <li v-for="row in preview.preview" :key="row.productId">
          <span>{{ row.name }}</span>
          <span>{{ formatAud(row.salePriceCents) }} · 至 {{ row.promotionEnd }}</span>
        </li>
      </ul>
      <van-button
        block
        type="primary"
        :loading="busy"
        :disabled="busy || !preview.validCount"
        @click="runImport"
        >正式匯入 {{ preview.validCount }} 筆</van-button
      >
    </div>

    <h3>最近匯入</h3>
    <p v-if="!runs.length" class="specials-import__empty">還沒有匯入紀錄。</p>
    <article v-for="run in runs" :key="run.id" class="specials-import__run">
      <div>
        <strong>{{ STATUS_LABELS[run.status] || run.status }}</strong>
        <span>{{ run.regionCode }} · {{ run.importedCount }}/{{ run.rowCount }} 筆</span>
      </div>
      <small
        >{{ formatTime(run.finishedAt || run.startedAt)
        }}{{ run.sourceReference ? ` · ${run.sourceReference}` : '' }}</small
      >
      <pre v-if="run.errorSummary">{{ run.errorSummary }}</pre>
    </article>
  </div>
</template>

<style scoped>
.specials-import {
  display: grid;
  gap: 10px;
}
.specials-import__intro {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.6;
}
.specials-import__template {
  display: block;
  overflow-x: auto;
  padding: 8px;
  border-radius: 8px;
  background: #f4f6f9;
  font-size: 11px;
  white-space: nowrap;
}
.specials-import__file {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 12px;
  border: 1px dashed var(--color-border);
  border-radius: 10px;
  color: var(--color-primary);
  font-weight: 700;
  cursor: pointer;
}
.specials-import__file input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.specials-import__preview {
  display: grid;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  background: #f7f9fc;
  font-size: 13px;
}
.specials-import__preview p {
  margin: 0;
}
.is-alert {
  color: var(--color-expense);
}
.specials-import__errors,
.specials-import__rows {
  display: grid;
  gap: 4px;
  max-height: 200px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  font-size: 12px;
}
.specials-import__errors {
  color: var(--color-expense);
}
.specials-import__rows li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.specials-import h3 {
  margin: 8px 0 0;
  font-size: 15px;
}
.specials-import__empty {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
}
.specials-import__run {
  display: grid;
  gap: 2px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
}
.specials-import__run div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.specials-import__run small {
  color: var(--color-muted);
}
.specials-import__run pre {
  margin: 4px 0 0;
  max-height: 120px;
  overflow: auto;
  color: var(--color-expense);
  font-size: 11px;
  white-space: pre-wrap;
}
</style>

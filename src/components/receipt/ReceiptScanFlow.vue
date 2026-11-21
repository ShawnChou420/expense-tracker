<script setup>
// 收據掃描全頁流程（Sprint 1 PoC）：拍照 → 預覽（重拍／旋轉）→ 辨識 → 顯示辨識文字。
// 照片與辨識文字只存在這個元件的記憶體，關閉時立即釋放；不上傳、不寫 log。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  checkReceiptFile,
  classifyImageError,
  decodeReceiptImage,
  prepareReceiptImage,
} from '../../services/receipt/imagePrep.js'
import { createReceiptOcr, OcrCancelledError } from '../../services/receipt/ocrClient.js'

const props = defineProps({ show: { type: Boolean, default: false } })
const emit = defineEmits(['update:show', 'manual'])
const { t } = useI18n()

/** @type {import('vue').Ref<'capture' | 'preparing' | 'preview' | 'recognizing' | 'result' | 'error'>} */
const step = ref('capture')
const errorCode = ref('')
const errorStage = ref('')
const previewUrl = ref('')
const rotation = ref(0)
const progress = ref({ phase: 'LOADING', percent: 0 })
const result = ref(null)
const elapsedMs = ref(0)
const cameraInput = ref(null)
const galleryInput = ref(null)

/** @type {{ source: CanvasImageSource, width: number, height: number, release: () => void } | null} */
let decoded = null
/** @type {Blob | null} */
let prepared = null
let ocr = null
let runId = 0

const title = computed(() =>
  step.value === 'result' ? t('receipt.resultTitle') : t('receipt.scanTitle'),
)
const lowConfidenceCount = computed(
  () => result.value?.lines.filter((line) => line.confidence < 60).length ?? 0,
)

function releaseImage() {
  decoded?.release()
  decoded = null
  prepared = null
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
}

function reset() {
  runId += 1
  releaseImage()
  result.value = null
  rotation.value = 0
  errorCode.value = ''
  step.value = 'capture'
}

function close() {
  emit('update:show', false)
}

watch(
  () => props.show,
  (open) => {
    if (open) return
    // 關閉時停止辨識並釋放所有記憶體
    reset()
    ocr?.dispose()
    ocr = null
  },
)
onBeforeUnmount(() => {
  releaseImage()
  ocr?.dispose()
})

function pick(kind) {
  const input = kind === 'camera' ? cameraInput.value : galleryInput.value
  if (!input) return
  input.value = ''
  input.click()
}

function showError(code, stage) {
  errorCode.value = code
  errorStage.value = stage
  step.value = 'error'
}

async function renderPreview() {
  if (!decoded) return
  const id = ++runId
  step.value = 'preparing'
  try {
    const output = await prepareReceiptImage(decoded, { rotation: rotation.value })
    if (id !== runId) return
    prepared = output.blob
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = URL.createObjectURL(output.blob)
    step.value = 'preview'
  } catch (error) {
    if (id === runId) showError(classifyImageError(error), 'image')
  }
}

async function onFileChange(event) {
  const input = /** @type {HTMLInputElement} */ (event.target)
  const file = input.files?.[0]
  input.value = ''
  if (!file) return // 使用者取消：留在原畫面
  releaseImage()
  rotation.value = 0
  step.value = 'preparing'
  try {
    checkReceiptFile(file)
    decoded = await decodeReceiptImage(file)
  } catch (error) {
    showError(classifyImageError(error), 'image')
    return
  }
  await renderPreview()
}

function rotate() {
  rotation.value = (rotation.value + 90) % 360
  renderPreview()
}

async function recognize() {
  if (!prepared) return
  const id = ++runId
  progress.value = { phase: 'LOADING', percent: 0 }
  step.value = 'recognizing'
  ocr ??= createReceiptOcr()
  const started = performance.now()
  try {
    const output = await ocr.recognize(prepared, {
      onProgress: (value) => {
        if (id === runId) progress.value = value
      },
    })
    if (id !== runId) return
    elapsedMs.value = Math.round(performance.now() - started)
    result.value = output
    step.value = 'result'
  } catch (error) {
    if (id !== runId || error instanceof OcrCancelledError) return
    showError(navigator.onLine === false ? 'OFFLINE' : 'OCR_FAILED', 'ocr')
  }
}

async function cancelRecognition() {
  runId += 1
  await ocr?.cancel()
  step.value = prepared ? 'preview' : 'capture'
}

function retry() {
  if (errorStage.value === 'ocr' && prepared) recognize()
  else reset()
}

function manual() {
  emit('manual')
  close()
}
</script>

<template>
  <van-popup
    :show="show"
    position="right"
    safe-area-inset-bottom
    class="receipt-sheet full-page-popup"
    @update:show="emit('update:show', $event)"
  >
    <div class="receipt">
      <header class="receipt__header full-page__header">
        <h2>{{ title }}</h2>
        <button type="button" class="full-page__back" :aria-label="t('common.back')" @click="close">
          <van-icon name="arrow-left" />
        </button>
      </header>

      <input
        ref="cameraInput"
        class="receipt__file"
        type="file"
        accept="image/*"
        capture="environment"
        tabindex="-1"
        aria-hidden="true"
        @change="onFileChange"
      />
      <input
        ref="galleryInput"
        class="receipt__file"
        type="file"
        accept="image/*"
        tabindex="-1"
        aria-hidden="true"
        @change="onFileChange"
      />

      <section v-if="step === 'capture'" class="receipt__body">
        <p class="receipt__lead">{{ t('receipt.lead') }}</p>
        <ul class="receipt__tips">
          <li>{{ t('receipt.tipFlat') }}</li>
          <li>{{ t('receipt.tipLight') }}</li>
          <li>{{ t('receipt.tipPrivacy') }}</li>
        </ul>
        <van-button type="primary" block round icon="photograph" @click="pick('camera')">
          {{ t('receipt.takePhoto') }}
        </van-button>
        <van-button block round plain icon="photo-o" @click="pick('gallery')">
          {{ t('receipt.chooseFromGallery') }}
        </van-button>
        <p class="receipt__hint">{{ t('receipt.cameraHint') }}</p>
        <button type="button" class="receipt__link" @click="manual">
          {{ t('receipt.manualEntry') }}
        </button>
      </section>

      <section v-else-if="step === 'preparing'" class="receipt__body receipt__center">
        <van-loading size="28px" vertical>{{ t('receipt.preparing') }}</van-loading>
      </section>

      <section v-else-if="step === 'preview'" class="receipt__body">
        <div class="receipt__preview">
          <img :src="previewUrl" :alt="t('receipt.previewAlt')" />
        </div>
        <div class="receipt__row">
          <van-button round plain icon="replay" @click="rotate">{{
            t('receipt.rotate')
          }}</van-button>
          <van-button round plain icon="photograph" @click="pick('camera')">
            {{ t('receipt.retake') }}
          </van-button>
        </div>
        <van-button type="primary" block round @click="recognize">
          {{ t('receipt.startRecognition') }}
        </van-button>
      </section>

      <section
        v-else-if="step === 'recognizing'"
        class="receipt__body receipt__center"
        aria-live="polite"
      >
        <van-circle
          :current-rate="progress.percent"
          :rate="100"
          :text="`${progress.percent}%`"
          size="120px"
          layer-color="var(--color-border)"
          color="var(--color-primary)"
        />
        <p class="receipt__status">
          {{ progress.phase === 'LOADING' ? t('receipt.loadingModel') : t('receipt.recognizing') }}
        </p>
        <p v-if="progress.phase === 'LOADING'" class="receipt__hint">
          {{ t('receipt.firstTimeDownload') }}
        </p>
        <van-button round plain @click="cancelRecognition">{{ t('common.cancel') }}</van-button>
      </section>

      <section v-else-if="step === 'result' && result" class="receipt__body">
        <p class="receipt__meta">
          {{
            t('receipt.resultMeta', {
              seconds: (elapsedMs / 1000).toFixed(1),
              confidence: result.confidence,
              lines: result.lines.length,
            })
          }}
        </p>
        <p v-if="!result.lines.length" class="receipt__warning">{{ t('receipt.noText') }}</p>
        <p v-else-if="lowConfidenceCount" class="receipt__warning">
          {{ t('receipt.lowConfidenceLines', { count: lowConfidenceCount }) }}
        </p>
        <p class="receipt__hint">{{ t('receipt.pocNote') }}</p>
        <ol class="receipt__lines">
          <li
            v-for="(line, index) in result.lines"
            :key="index"
            :class="{ 'is-low': line.confidence < 60 }"
          >
            <span lang="en">{{ line.text }}</span>
            <small>{{ line.confidence }}%</small>
          </li>
        </ol>
        <div class="receipt__row">
          <van-button round plain @click="reset">{{ t('receipt.scanAnother') }}</van-button>
          <van-button round type="primary" @click="manual">{{
            t('receipt.manualEntry')
          }}</van-button>
        </div>
      </section>

      <section v-else-if="step === 'error'" class="receipt__body receipt__center" role="alert">
        <van-icon name="warning-o" size="40" color="var(--color-pending)" />
        <p class="receipt__status">{{ t(`receipt.errors.${errorCode}`) }}</p>
        <van-button type="primary" round @click="retry">
          {{ errorStage === 'ocr' ? t('receipt.retry') : t('receipt.tryAgain') }}
        </van-button>
        <button type="button" class="receipt__link" @click="manual">
          {{ t('receipt.manualEntry') }}
        </button>
      </section>
    </div>
  </van-popup>
</template>

<style scoped>
.receipt {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}
.receipt__header {
  padding: 12px var(--page-inset);
}
.receipt__header h2 {
  margin: 0;
  font-size: var(--font-heading);
}
.receipt__file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.receipt__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-row);
  padding: 0 var(--page-inset) var(--space-3);
}
.receipt__center {
  flex: 1;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.receipt__lead {
  margin: 0;
  font-size: var(--font-body);
  color: var(--color-heading);
}
.receipt__tips {
  margin: 0 0 var(--space-1);
  padding-left: 20px;
  color: var(--color-muted);
  font-size: var(--font-caption);
  line-height: 1.6;
}
.receipt__link {
  align-self: center;
  padding: var(--space-1);
  background: none;
  border: 0;
  color: var(--color-primary);
  font-size: var(--font-body);
}
.receipt__preview {
  display: flex;
  justify-content: center;
  max-height: 60vh;
  overflow: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
}
.receipt__preview img {
  max-width: 100%;
  height: auto;
  object-fit: contain;
}
.receipt__row {
  display: flex;
  gap: var(--space-1);
}
.receipt__row > * {
  flex: 1;
}
.receipt__status {
  margin: var(--space-1) 0 0;
  font-size: var(--font-body);
  color: var(--color-heading);
}
.receipt__hint,
.receipt__meta {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--font-caption);
}
.receipt__warning {
  margin: 0;
  padding: var(--space-1) var(--space-row);
  border-radius: var(--radius-small);
  background: var(--color-pending-soft);
  color: var(--color-pending);
  font-size: var(--font-caption);
}
.receipt__lines {
  margin: 0;
  padding: var(--space-1) 0;
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.receipt__lines li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-1);
  padding: 2px var(--space-row);
}
.receipt__lines li span {
  white-space: pre-wrap;
  word-break: break-word;
}
.receipt__lines li small {
  flex: none;
  color: var(--color-muted);
}
.receipt__lines li.is-low {
  background: var(--color-pending-soft);
}
</style>

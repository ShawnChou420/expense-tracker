<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArcElement, Chart, DoughnutController, Legend, Tooltip } from 'chart.js'
import { formatAud } from '../domain/money.js'

Chart.register(ArcElement, DoughnutController, Legend, Tooltip)

const props = defineProps({ distribution: { type: Object, required: true }, active: Boolean })
const emit = defineEmits(['select'])
const canvas = ref(null)
let chart = null

function renderChart() {
  if (!canvas.value || !props.distribution.chart.length) return
  chart?.destroy()
  chart = new Chart(canvas.value, {
    type: 'doughnut',
    data: {
      labels: props.distribution.chart.map((entry) => entry.label),
      datasets: [
        {
          data: props.distribution.chart.map((entry) => entry.amountCents),
          backgroundColor: props.distribution.chart.map((entry) => entry.color),
          borderColor: '#fff',
          borderWidth: 3,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: '72%',
      onClick: (_event, elements) => {
        if (elements[0]) emit('select', props.distribution.chart[elements[0].index])
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (context) => `${context.label} ${formatAud(context.parsed)}` },
        },
      },
    },
  })
}

onMounted(renderChart)
onBeforeUnmount(() => chart?.destroy())
watch(
  () => props.distribution,
  () => nextTick(renderChart),
)
watch(
  () => props.active,
  (active) => {
    if (active) nextTick(() => chart?.resize())
  },
)
</script>

<template>
  <div class="donut-frame">
    <canvas ref="canvas" aria-label="已支付支出環形圖，點擊區塊查看金額" role="img"></canvas>
    <div class="donut-center">
      <small>已支付</small><strong>{{ formatAud(distribution.totalCents) }}</strong>
    </div>
  </div>
</template>

<style scoped>
.donut-frame {
  position: relative;
  width: min(100%, 250px);
  height: 250px;
  margin-inline: auto;
}
.donut-center {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  pointer-events: none;
}
.donut-center small {
  color: #657588;
  font-size: 12px;
}
.donut-center strong {
  color: #1b2a3b;
  font-size: clamp(18px, 5vw, 24px);
  font-weight: 800;
  overflow-wrap: anywhere;
}
</style>

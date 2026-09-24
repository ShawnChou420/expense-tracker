<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Chart,
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { formatAud } from '../domain/money.js'

Chart.register(
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
)

const props = defineProps({
  points: { type: Array, required: true },
  mode: { type: String, required: true },
  active: Boolean,
})
const emit = defineEmits(['select'])
const canvas = ref(null)
let chart = null

function renderChart() {
  if (!canvas.value || !props.points.length) return
  chart?.destroy()
  const key = props.mode === 'actual' ? 'actualCents' : 'estimatedCents'
  chart = new Chart(canvas.value, {
    type: 'line',
    data: {
      labels: props.points.map((point) => point.date.slice(5)),
      datasets: [
        {
          label: props.mode === 'actual' ? '已收車資' : '預估工作收入',
          data: props.points.map((point) => point[key] / 100),
          borderColor: '#1976d2',
          backgroundColor: 'rgba(25, 118, 210, .10)',
          borderWidth: 2,
          pointRadius: props.points.length > 14 ? 2 : 4,
          pointHitRadius: 18,
          pointHoverRadius: 6,
          tension: 0,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      onClick: (event, _elements, instance) => {
        const nearest = instance.getElementsAtEventForMode(
          event,
          'nearest',
          { axis: 'x', intersect: false },
          false,
        )
        if (nearest[0]) emit('select', props.points[nearest[0].index])
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (context) => formatAud(Math.round(context.parsed.y * 100)) },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 6, maxRotation: 0, color: '#657588' },
        },
        y: {
          beginAtZero: true,
          ticks: { maxTicksLimit: 5, color: '#657588', callback: (value) => `$${value}` },
        },
      },
    },
  })
}

onMounted(renderChart)
onBeforeUnmount(() => chart?.destroy())
watch(
  () => [props.points, props.mode],
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
  <div class="chart-frame">
    <canvas ref="canvas" aria-label="每日收入折線圖，點擊資料點查看金額" role="img"></canvas>
  </div>
</template>

<style scoped>
.chart-frame {
  position: relative;
  width: 100%;
  height: 210px;
}
</style>

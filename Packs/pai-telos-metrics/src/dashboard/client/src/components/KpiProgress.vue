<template>
  <div
    class="rounded-lg"
    :class="compact ? 'p-2' : 'bg-[var(--bg-tertiary)] p-3'"
  >
    <div class="flex justify-between items-center mb-2">
      <span class="text-sm" :class="compact ? 'text-[var(--text-primary)]' : 'font-medium'">
        {{ kpi.kpi.name }}
      </span>
      <div class="flex items-center gap-2">
        <span v-if="kpi.streak >= 3" class="text-xs text-[var(--accent-yellow)]">
          {{ kpi.streak }}d
        </span>
        <span class="text-sm font-mono" :class="statusColor">
          {{ kpi.current }}/{{ kpi.target }}
        </span>
      </div>
    </div>

    <!-- Progress Bar -->
    <div class="h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
      <div
        class="h-full progress-bar rounded-full"
        :class="barColor"
        :style="{ width: kpi.percentage + '%' }"
      />
    </div>

    <!-- Extended view with sparkline -->
    <div v-if="!compact" class="mt-3 flex items-center justify-between">
      <div class="sparkline flex-1 max-w-[120px]">
        <div
          v-for="(value, idx) in kpi.trend"
          :key="idx"
          class="sparkline-bar"
          :class="{ 'today': idx === kpi.trend.length - 1 }"
          :style="{ height: getSparklineHeight(value) + '%' }"
        />
      </div>
      <span class="text-xs text-[var(--text-secondary)]">
        {{ kpi.kpi.unit || '' }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface KpiConfig {
  id: string
  name: string
  target: number
  unit?: string
}

interface KpiProgressData {
  kpi: KpiConfig
  current: number
  target: number
  percentage: number
  onTrack: boolean
  streak: number
  trend: number[]
}

const props = defineProps<{
  kpi: KpiProgressData
  compact?: boolean
}>()

const statusColor = computed(() => {
  return props.kpi.onTrack
    ? 'text-[var(--accent-green)]'
    : 'text-[var(--accent-yellow)]'
})

const barColor = computed(() => {
  if (props.kpi.percentage >= 100) return 'bg-[var(--accent-green)]'
  if (props.kpi.percentage >= 50) return 'bg-[var(--accent-blue)]'
  return 'bg-[var(--accent-yellow)]'
})

function getSparklineHeight(value: number): number {
  const max = Math.max(...props.kpi.trend, props.kpi.target)
  if (max === 0) return 10
  return Math.min(Math.max((value / max) * 100, 10), 100)
}
</script>

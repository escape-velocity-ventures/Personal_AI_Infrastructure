<template>
  <div class="bg-[var(--bg-secondary)] rounded-lg p-4">
    <!-- Header -->
    <div class="flex justify-between items-start mb-3">
      <div>
        <span class="text-[var(--accent-blue)] font-mono text-sm">{{ goal.id }}</span>
        <span
          v-if="goal.category"
          class="ml-2 text-xs px-2 py-0.5 rounded-full"
          :class="categoryClass"
        >
          {{ goal.category }}
        </span>
      </div>
      <div class="text-right">
        <span class="text-lg font-bold" :class="progressColor">{{ goalProgress }}%</span>
      </div>
    </div>

    <!-- Description -->
    <p class="text-[var(--text-primary)] text-sm mb-4">
      {{ truncate(goal.content, 100) }}
    </p>

    <!-- Overall Progress Bar -->
    <div class="h-2 bg-[var(--bg-primary)] rounded-full mb-4 overflow-hidden">
      <div
        class="h-full progress-bar rounded-full"
        :class="progressBarColor"
        :style="{ width: goalProgress + '%' }"
      />
    </div>

    <!-- KPIs -->
    <div v-if="kpis.length > 0" class="space-y-2">
      <div
        v-for="kpi in kpis"
        :key="kpi.kpi.id"
        class="flex items-center gap-3"
      >
        <div class="flex-1 min-w-0">
          <div class="flex justify-between text-xs mb-1">
            <span class="text-[var(--text-secondary)] truncate">{{ kpi.kpi.name }}</span>
            <span class="text-[var(--text-primary)]">
              {{ kpi.current }}/{{ kpi.target }} {{ kpi.kpi.unit || '' }}
            </span>
          </div>
          <div class="h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="kpi.onTrack ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-yellow)]'"
              :style="{ width: kpi.percentage + '%' }"
            />
          </div>
        </div>

        <!-- Mini Sparkline -->
        <div class="sparkline w-16 h-4">
          <div
            v-for="(value, idx) in kpi.trend"
            :key="idx"
            class="sparkline-bar"
            :class="{ 'today': idx === kpi.trend.length - 1 }"
            :style="{ height: getSparklineHeight(value, kpi.target) + '%' }"
          />
        </div>

        <!-- Streak indicator -->
        <span v-if="kpi.streak >= 3" class="text-xs">
          {{ kpi.streak }}d
        </span>
      </div>
    </div>

    <div v-else class="text-[var(--text-secondary)] text-sm">
      No KPIs linked to this goal
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface KpiConfig {
  id: string
  name: string
  goal_ref: string | null
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

interface Goal {
  id: string
  content: string
  category?: string
}

const props = defineProps<{
  goal: Goal
  kpis: KpiProgressData[]
}>()

const categoryClass = computed(() => {
  if (props.goal.category === 'Professional') {
    return 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]'
  }
  return 'bg-[var(--accent-purple)]/20 text-[var(--accent-purple)]'
})

const goalProgress = computed(() => {
  if (props.kpis.length === 0) return 0
  const total = props.kpis.reduce((sum, k) => sum + k.percentage, 0)
  return Math.round(total / props.kpis.length)
})

const progressColor = computed(() => {
  const progress = goalProgress.value
  if (progress >= 80) return 'text-[var(--accent-green)]'
  if (progress >= 50) return 'text-[var(--accent-yellow)]'
  return 'text-[var(--accent-red)]'
})

const progressBarColor = computed(() => {
  const progress = goalProgress.value
  if (progress >= 80) return 'bg-[var(--accent-green)]'
  if (progress >= 50) return 'bg-[var(--accent-yellow)]'
  return 'bg-[var(--accent-red)]'
})

function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len) + '...'
}

function getSparklineHeight(value: number, target: number): number {
  if (target === 0) return 10
  const percentage = (value / target) * 100
  return Math.min(Math.max(percentage, 10), 100)
}
</script>

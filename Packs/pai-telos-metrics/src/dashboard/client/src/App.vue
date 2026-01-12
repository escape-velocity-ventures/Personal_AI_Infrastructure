<template>
  <div class="min-h-screen bg-[var(--bg-primary)] p-6">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex justify-between items-center">
        <div>
          <h1 class="text-2xl font-bold text-[var(--accent-blue)]">
            TELOS Metrics
          </h1>
          <p class="text-[var(--text-secondary)] text-sm">
            {{ isConnected ? 'Connected' : 'Disconnected' }}
            · Last updated: {{ formatTime(dashboardData?.lastUpdated) }}
          </p>
        </div>
        <div class="text-right">
          <div class="text-3xl font-bold" :class="alignmentColor">
            {{ dashboardData?.alignmentScore || 0 }}%
          </div>
          <div class="text-sm text-[var(--text-secondary)]">
            {{ dashboardData?.onTrackCount || 0 }}/{{ dashboardData?.totalCount || 0 }} on track
          </div>
        </div>
      </div>
    </header>

    <!-- Main Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Goals Column -->
      <div class="lg:col-span-2 space-y-4">
        <h2 class="text-lg font-semibold text-[var(--text-primary)]">Goals</h2>
        <div class="space-y-4">
          <GoalCard
            v-for="goal in dashboardData?.goals"
            :key="goal.id"
            :goal="goal"
            :kpis="getKpisForGoal(goal.id)"
          />
        </div>
      </div>

      <!-- Sidebar -->
      <div class="space-y-6">
        <!-- Today's Focus -->
        <div class="bg-[var(--bg-secondary)] rounded-lg p-4">
          <h3 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            Today's Focus
          </h3>
          <div class="space-y-3">
            <KpiProgress
              v-for="kpi in focusKpis"
              :key="kpi.kpi.id"
              :kpi="kpi"
              :compact="true"
            />
          </div>
          <div v-if="focusKpis.length === 0" class="text-[var(--text-secondary)] text-sm">
            All daily KPIs on track!
          </div>
        </div>

        <!-- Active Streaks -->
        <div class="bg-[var(--bg-secondary)] rounded-lg p-4">
          <h3 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            Active Streaks
          </h3>
          <div class="space-y-2">
            <StreakBadge
              v-for="kpi in activeStreaks"
              :key="kpi.kpi.id"
              :name="kpi.kpi.name"
              :days="kpi.streak"
            />
          </div>
          <div v-if="activeStreaks.length === 0" class="text-[var(--text-secondary)] text-sm">
            Start tracking to build streaks!
          </div>
        </div>

        <!-- Quick Log -->
        <div class="bg-[var(--bg-secondary)] rounded-lg p-4">
          <h3 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            Quick Log
          </h3>
          <p class="text-xs text-[var(--text-secondary)]">
            Use CLI to log metrics:
          </p>
          <code class="block mt-2 text-xs bg-[var(--bg-primary)] p-2 rounded text-[var(--accent-green)]">
            bun run MetricsLogger.ts log --kpi &lt;id&gt; --value &lt;n&gt;
          </code>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import GoalCard from './components/GoalCard.vue'
import KpiProgress from './components/KpiProgress.vue'
import StreakBadge from './components/StreakBadge.vue'

interface KpiConfig {
  id: string
  name: string
  description: string
  goal_ref: string | null
  type: string
  target: number
  frequency: string
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

interface DashboardData {
  goals: Goal[]
  kpis: KpiProgressData[]
  alignmentScore: number
  onTrackCount: number
  totalCount: number
  lastUpdated: string
}

const dashboardData = ref<DashboardData | null>(null)
const isConnected = ref(false)
let ws: WebSocket | null = null

const alignmentColor = computed(() => {
  const score = dashboardData.value?.alignmentScore || 0
  if (score >= 80) return 'text-[var(--accent-green)]'
  if (score >= 50) return 'text-[var(--accent-yellow)]'
  return 'text-[var(--accent-red)]'
})

const focusKpis = computed(() => {
  if (!dashboardData.value) return []
  return dashboardData.value.kpis
    .filter(k => !k.onTrack && k.kpi.frequency === 'daily')
    .slice(0, 5)
})

const activeStreaks = computed(() => {
  if (!dashboardData.value) return []
  return dashboardData.value.kpis
    .filter(k => k.streak >= 3)
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 5)
})

function getKpisForGoal(goalId: string): KpiProgressData[] {
  if (!dashboardData.value) return []
  return dashboardData.value.kpis.filter(k => k.kpi.goal_ref === goalId)
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleTimeString()
}

function connect() {
  ws = new WebSocket('ws://localhost:4100/stream')

  ws.onopen = () => {
    isConnected.value = true
    console.log('Connected to TELOS Metrics server')
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)

    if (data.type === 'initial' || data.type === 'update') {
      dashboardData.value = data.data
    }
  }

  ws.onclose = () => {
    isConnected.value = false
    console.log('Disconnected from server')
    setTimeout(connect, 3000)
  }

  ws.onerror = (error) => {
    console.error('WebSocket error:', error)
  }
}

onMounted(() => {
  connect()
})

onUnmounted(() => {
  ws?.close()
})
</script>

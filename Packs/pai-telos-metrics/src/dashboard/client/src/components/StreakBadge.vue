<template>
  <div class="flex items-center gap-2 py-1">
    <span class="text-lg">{{ streakEmoji }}</span>
    <div class="flex-1 min-w-0">
      <span class="text-sm text-[var(--text-primary)] truncate block">
        {{ name }}
      </span>
    </div>
    <span class="text-sm font-bold" :class="streakColor">
      {{ days }}d
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  name: string
  days: number
}>()

const streakEmoji = computed(() => {
  if (props.days >= 90) return '🏆'
  if (props.days >= 30) return '⭐'
  if (props.days >= 14) return '🔥'
  if (props.days >= 7) return '✨'
  return '💪'
})

const streakColor = computed(() => {
  if (props.days >= 30) return 'text-[var(--accent-yellow)]'
  if (props.days >= 7) return 'text-[var(--accent-green)]'
  return 'text-[var(--accent-blue)]'
})
</script>

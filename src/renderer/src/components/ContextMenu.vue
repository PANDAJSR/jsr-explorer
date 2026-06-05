<script setup lang="ts">
type ContextMenuItem = {
  enabled: boolean
  label: string
  action: () => void
}

defineProps<{
  items: ContextMenuItem[]
  x: number
  y: number
}>()
</script>

<template>
  <div class="context-menu" :style="{ left: `${x}px`, top: `${y}px` }" @mousedown.stop @contextmenu.prevent>
    <button
      v-for="item in items"
      :key="item.label"
      class="context-menu-item"
      type="button"
      :disabled="!item.enabled"
      @click="item.action"
    >
      {{ item.label }}
    </button>
  </div>
</template>

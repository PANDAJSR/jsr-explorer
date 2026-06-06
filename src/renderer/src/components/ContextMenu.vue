<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type ContextMenuItem = {
  enabled: boolean
  label: string
  action?: () => void
  children?: ContextMenuItem[]
}

const props = defineProps<{
  items: ContextMenuItem[]
  x: number
  y: number
}>()

const viewportPadding = 8
const menu = ref<HTMLElement | null>(null)
const position = ref({ x: props.x, y: props.y })

const clampMenuToViewport = async (): Promise<void> => {
  position.value = { x: props.x, y: props.y }
  await nextTick()

  const rect = menu.value?.getBoundingClientRect()

  if (!rect) {
    return
  }

  const maxX = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding)
  const maxY = Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding)

  position.value = {
    x: Math.min(Math.max(props.x, viewportPadding), maxX),
    y: Math.min(Math.max(props.y, viewportPadding), maxY)
  }
}

watch(() => [props.x, props.y, props.items.length], clampMenuToViewport, { immediate: true })

onMounted(() => {
  window.addEventListener('resize', clampMenuToViewport)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', clampMenuToViewport)
})

const runItemAction = (item: ContextMenuItem): void => {
  if (!item.enabled || item.children?.length) {
    return
  }

  item.action?.()
}
</script>

<template>
  <div
    ref="menu"
    class="context-menu"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    @mousedown.stop
    @contextmenu.prevent
  >
    <div
      v-for="item in items"
      :key="item.label"
      class="context-menu-row"
      :class="{ 'has-submenu': item.children?.length }"
    >
      <button
        class="context-menu-item"
        type="button"
        :disabled="!item.enabled"
        @click="runItemAction(item)"
      >
        <span>{{ item.label }}</span>
        <span v-if="item.children?.length" class="context-menu-arrow">›</span>
      </button>
      <div v-if="item.children?.length" class="context-submenu">
        <button
          v-for="child in item.children"
          :key="child.label"
          class="context-menu-item"
          type="button"
          :disabled="!child.enabled"
          @click="runItemAction(child)"
        >
          <span>{{ child.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FavoritePath } from '../file-manager/types'

const props = defineProps<{
  currentPath: string
  favorites: FavoritePath[]
}>()

const emit = defineEmits<{
  addCurrent: []
  close: []
  jump: [favorite: FavoritePath]
  remove: [favoriteId: string]
  reorder: [sourceIndex: number, targetIndex: number]
}>()

const draggedIndex = ref<number | null>(null)
const hoveredIndex = ref<number | null>(null)

const isCurrentPathSaved = computed(() => props.favorites.some((favorite) => favorite.path === props.currentPath))

const getShortcutLabel = (index: number): string => (index < 9 ? `Shift ${index + 1}` : '')

const startDrag = (index: number): void => {
  draggedIndex.value = index
}

const enterDropTarget = (index: number): void => {
  if (draggedIndex.value !== null) {
    hoveredIndex.value = index
  }
}

const finishDrop = (targetIndex: number): void => {
  if (draggedIndex.value !== null && draggedIndex.value !== targetIndex) {
    emit('reorder', draggedIndex.value, targetIndex)
  }

  draggedIndex.value = null
  hoveredIndex.value = null
}

const cancelDrag = (): void => {
  draggedIndex.value = null
  hoveredIndex.value = null
}
</script>

<template>
  <div class="favorites-backdrop" role="presentation" @mousedown.self="emit('close')">
    <section class="favorites-manager" role="dialog" aria-modal="true" aria-labelledby="favorites-title">
      <header class="favorites-header">
        <h1 id="favorites-title">收藏路径</h1>
        <button class="icon-button" type="button" title="关闭" aria-label="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="favorites-actions">
        <button class="primary-button" type="button" :disabled="isCurrentPathSaved" @click="emit('addCurrent')">
          收藏当前路径
        </button>
        <span class="favorites-current-path" :title="currentPath">{{ currentPath }}</span>
      </div>

      <div v-if="favorites.length === 0" class="favorites-empty">暂无收藏路径</div>
      <ol v-else class="favorites-list" aria-label="收藏路径列表">
        <li
          v-for="(favorite, index) in favorites"
          :key="favorite.id"
          class="favorite-row"
          :class="{ 'is-drop-target': hoveredIndex === index }"
          draggable="true"
          @dragstart="startDrag(index)"
          @dragenter.prevent="enterDropTarget(index)"
          @dragover.prevent
          @drop.prevent="finishDrop(index)"
          @dragend="cancelDrag"
        >
          <span class="favorite-drag-handle" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M9 6h.01" />
              <path d="M15 6h.01" />
              <path d="M9 12h.01" />
              <path d="M15 12h.01" />
              <path d="M9 18h.01" />
              <path d="M15 18h.01" />
            </svg>
          </span>
          <button class="favorite-main" type="button" :title="favorite.path" @click="emit('jump', favorite)">
            <span class="favorite-title">{{ favorite.title }}</span>
            <span class="favorite-path">{{ favorite.path }}</span>
          </button>
          <span v-if="getShortcutLabel(index)" class="favorite-shortcut">{{ getShortcutLabel(index) }}</span>
          <button class="favorite-remove" type="button" title="移除收藏" @click="emit('remove', favorite.id)">
            移除
          </button>
        </li>
      </ol>
    </section>
  </div>
</template>

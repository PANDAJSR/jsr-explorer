<script setup lang="ts">
import { useFileManager } from './composables/useFileManager'

const {
  addCurrentPathToFavorites,
  cancelNameDialog,
  ContextMenu,
  contextMenu,
  FavoritesManager,
  favorites,
  focusedTab,
  isFavoritesManagerOpen,
  jumpToFavorite,
  NameDialog,
  nameDialog,
  removeFavoritePath,
  reorderFavoritePaths,
  rootNode,
  SplitNodeView,
  submitNameDialog
} = useFileManager()
</script>

<template>
  <main class="file-manager">
    <SplitNodeView :node="rootNode" />
    <ContextMenu v-if="contextMenu" :items="contextMenu.items" :x="contextMenu.x" :y="contextMenu.y" />
    <FavoritesManager
      v-if="isFavoritesManagerOpen && focusedTab"
      :current-path="focusedTab.currentPath"
      :favorites="favorites"
      @add-current="addCurrentPathToFavorites"
      @close="isFavoritesManagerOpen = false"
      @jump="jumpToFavorite"
      @remove="removeFavoritePath"
      @reorder="reorderFavoritePaths"
    />
    <NameDialog
      v-if="nameDialog"
      :title="nameDialog.title"
      :default-value="nameDialog.defaultValue"
      @cancel="cancelNameDialog"
      @submit="submitNameDialog"
    />
  </main>
</template>

<script setup lang="ts">
import { useFileManager } from './composables/useFileManager'

const {
  addCurrentPathToFavorites,
  ArchiveDialog,
  archiveDialog,
  cancelArchiveDialog,
  cancelNameDialog,
  closeQuickPreview,
  ContextMenu,
  contextMenu,
  FavoritesManager,
  favorites,
  focusedTab,
  isFavoritesManagerOpen,
  jumpToFavorite,
  NameDialog,
  nameDialog,
  QuickPreview,
  quickPreview,
  removeFavoritePath,
  reorderFavoritePaths,
  rootNode,
  SplitNodeView,
  submitArchiveDialog,
  submitNameDialog
} = useFileManager()
</script>

<template>
  <main class="file-manager">
    <SplitNodeView :node="rootNode" />
    <ContextMenu v-if="contextMenu" :items="contextMenu.items" :x="contextMenu.x" :y="contextMenu.y" />
    <ArchiveDialog
      v-if="archiveDialog"
      :default-file-name="archiveDialog.defaultFileName"
      :selected-count="archiveDialog.selectedCount"
      @cancel="cancelArchiveDialog"
      @submit="submitArchiveDialog"
    />
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
    <QuickPreview v-if="quickPreview" :preview="quickPreview" @close="closeQuickPreview" />
  </main>
</template>

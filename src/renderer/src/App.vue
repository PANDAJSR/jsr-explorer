<script setup lang="ts">
import { useFileManager } from './composables/useFileManager'

const {
  cancelNameDialog,
  ContextMenu,
  contextMenu,
  NameDialog,
  nameDialog,
  rootNode,
  SplitNodeView,
  submitNameDialog
} = useFileManager()
</script>

<template>
  <main class="file-manager">
    <SplitNodeView :node="rootNode" />
    <ContextMenu v-if="contextMenu" :items="contextMenu.items" :x="contextMenu.x" :y="contextMenu.y" />
    <NameDialog
      v-if="nameDialog"
      :title="nameDialog.title"
      :default-value="nameDialog.defaultValue"
      @cancel="cancelNameDialog"
      @submit="submitNameDialog"
    />
  </main>
</template>

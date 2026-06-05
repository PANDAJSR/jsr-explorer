<script setup lang="ts">
import { useFileManager } from './composables/useFileManager'

const { ContextMenu, contextMenu, rootNode, SplitNodeView } = useFileManager()
</script>

<template>
  <main class="file-manager">
    <SplitNodeView :node="rootNode" />
    <ContextMenu v-if="contextMenu" :items="contextMenu.items" :x="contextMenu.x" :y="contextMenu.y" />
  </main>
</template>

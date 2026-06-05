<script setup lang="ts">
import { useFileManager } from './composables/useFileManager'

const { rootNode, SplitNodeView } = useFileManager()
</script>

<template>
  <main class="file-manager">
    <SplitNodeView :node="rootNode" />
  </main>
</template>

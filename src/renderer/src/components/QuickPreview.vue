<script setup lang="ts">
import type { QuickPreviewState } from '../file-manager/types'

defineProps<{
  preview: QuickPreviewState
}>()

defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="quick-preview-backdrop" @click="$emit('close')">
    <section class="quick-preview" role="dialog" aria-modal="true" :aria-label="`预览 ${preview.entryName}`" @click.stop>
      <header class="quick-preview-header">
        <span class="quick-preview-title" :title="preview.entryName">{{ preview.entryName }}</span>
        <button class="quick-preview-close" type="button" title="关闭预览" @click="$emit('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="quick-preview-body">
        <img
          v-if="preview.kind === 'image'"
          class="quick-preview-image"
          :src="preview.sourceUrl"
          :alt="preview.entryName"
          draggable="false"
        />
        <video
          v-else-if="preview.kind === 'video'"
          class="quick-preview-media"
          :src="preview.sourceUrl"
          controls
          autoplay
        ></video>
        <audio v-else class="quick-preview-audio" :src="preview.sourceUrl" controls autoplay></audio>
      </div>
    </section>
  </div>
</template>

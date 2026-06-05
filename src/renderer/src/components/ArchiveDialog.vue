<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ArchiveCreationOptions, ArchiveFormat } from '../file-manager/types'

const props = defineProps<{
  defaultFileName: string
  selectedCount: number
}>()

const emit = defineEmits<{
  cancel: []
  submit: [options: ArchiveCreationOptions]
}>()

const fileNameInput = ref<HTMLInputElement | null>(null)
const format = ref<ArchiveFormat>('zip')
const compressionLevel = ref(6)
const password = ref('')
const outputName = ref('')

const extensionByFormat: Record<ArchiveFormat, string> = {
  zip: '.zip',
  'tar.gz': '.tar.gz'
}

const passwordDisabled = computed(() => format.value !== 'zip')

const withFormatExtension = (name: string, nextFormat = format.value): string => {
  const trimmedName = name.trim()
  const baseName = trimmedName.replace(/\.(zip|tar\.gz)$/i, '') || 'Archive'

  return `${baseName}${extensionByFormat[nextFormat]}`
}

watch(
  () => props.defaultFileName,
  (defaultFileName) => {
    outputName.value = withFormatExtension(defaultFileName || 'Archive.zip')
    void nextTick(() => {
      fileNameInput.value?.focus()
      fileNameInput.value?.select()
    })
  },
  { immediate: true }
)

watch(format, (nextFormat) => {
  outputName.value = withFormatExtension(outputName.value, nextFormat)

  if (passwordDisabled.value) {
    password.value = ''
  }
})

const submit = (): void => {
  const resolvedOutputName = withFormatExtension(outputName.value)

  if (!resolvedOutputName.trim()) {
    return
  }

  emit('submit', {
    compressionLevel: compressionLevel.value,
    format: format.value,
    outputName: resolvedOutputName,
    password: password.value
  })
}
</script>

<template>
  <div class="archive-dialog-backdrop" @mousedown.self="emit('cancel')">
    <form class="archive-dialog" @submit.prevent="submit" @keydown.escape.prevent="emit('cancel')">
      <header class="archive-dialog-header">
        <h1>打压缩包</h1>
        <span>{{ selectedCount }} 个对象</span>
      </header>

      <label class="archive-field">
        <span>格式</span>
        <select v-model="format" class="archive-select">
          <option value="zip">ZIP</option>
          <option value="tar.gz">TAR.GZ</option>
        </select>
      </label>

      <label class="archive-field">
        <span>压缩强度</span>
        <div class="archive-range-row">
          <input v-model.number="compressionLevel" class="archive-range" type="range" min="0" max="9" step="1" />
          <output class="archive-range-value">{{ compressionLevel }}</output>
        </div>
      </label>

      <label class="archive-field">
        <span>密码</span>
        <input
          v-model="password"
          class="archive-input"
          type="password"
          autocomplete="new-password"
          :disabled="passwordDisabled"
        />
      </label>

      <label class="archive-field">
        <span>生成文件名</span>
        <input ref="fileNameInput" v-model="outputName" class="archive-input" type="text" autocomplete="off" />
      </label>

      <div class="archive-dialog-actions">
        <button class="secondary-button" type="button" @click="emit('cancel')">取消</button>
        <button class="primary-button" type="submit" :disabled="!outputName.trim()">压缩</button>
      </div>
    </form>
  </div>
</template>

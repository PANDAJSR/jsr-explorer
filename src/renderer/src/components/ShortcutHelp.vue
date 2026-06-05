<script setup lang="ts">
import { computed } from 'vue'
import type { Platform } from '../file-manager/types'

const props = defineProps<{
  platform: Platform
}>()

const emit = defineEmits<{
  close: []
}>()

const primaryModifier = computed(() => (props.platform === 'darwin' ? 'Cmd' : 'Ctrl'))
const optionModifier = computed(() => (props.platform === 'darwin' ? 'Option' : 'Alt'))

const shortcutGroups = computed(() => [
  {
    title: '选择与预览',
    items: [
      { keys: ['↑', '↓'], description: '移动选中项' },
      { keys: ['Shift', '↑ / ↓'], description: '扩展连续选择' },
      { keys: ['Esc'], description: '清空选择或关闭当前弹窗' },
      { keys: ['Space'], description: '快速预览选中项；预览中再次关闭' }
    ]
  },
  {
    title: '文件操作',
    items: [
      { keys: [primaryModifier.value, 'O'], description: '打开选中项' },
      { keys: [primaryModifier.value, 'C'], description: '复制选中项到剪贴板' },
      { keys: [primaryModifier.value, 'X'], description: '剪切选中项到剪贴板' },
      { keys: [primaryModifier.value, 'V'], description: '粘贴到当前文件夹' },
      { keys: ['Shift', 'C'], description: '复制主焦点选中项到次焦点' },
      { keys: [optionModifier.value, 'C'], description: '移动主焦点选中项到次焦点' },
      { keys: ['Shift', 'R'], description: '重命名选中项' },
      { keys: ['Shift', 'F'], description: '新建文件夹；有选择时移入新文件夹' },
      { keys: ['Shift', 'Z'], description: '打压缩包' },
      { keys: ['Shift', 'Backspace'], description: '移入回收站' }
    ]
  },
  {
    title: '导航与窗格',
    items: [
      { keys: [primaryModifier.value, '['], description: '后退' },
      { keys: [primaryModifier.value, ']'], description: '前进' },
      { keys: [primaryModifier.value, '↑'], description: '进入上一级' },
      { keys: [primaryModifier.value, 'D'], description: '向右拆分窗格' },
      { keys: [primaryModifier.value, 'Shift', 'D'], description: '向下拆分窗格' },
      { keys: [optionModifier.value, '← / → / ↑ / ↓'], description: '移动主焦点到相邻窗格' },
      { keys: [primaryModifier.value, 'T'], description: '新建标签页' },
      { keys: [primaryModifier.value, 'W'], description: '关闭当前标签页或窗格' }
    ]
  },
  {
    title: '收藏与帮助',
    items: [
      { keys: [optionModifier.value, 'Shift', 'F'], description: '打开或关闭收藏管理' },
      { keys: ['Shift', '1 ... 9'], description: '跳转到对应收藏' },
      { keys: ['Shift', 'H'], description: '打开快捷键帮助' }
    ]
  }
])
</script>

<template>
  <section class="shortcut-help-backdrop" @mousedown.self="emit('close')">
    <article class="shortcut-help" role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title">
      <header class="shortcut-help-header">
        <h1 id="shortcut-help-title">快捷键</h1>
        <button class="shortcut-help-close" type="button" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="shortcut-help-body">
        <section v-for="group in shortcutGroups" :key="group.title" class="shortcut-group">
          <h2>{{ group.title }}</h2>
          <dl class="shortcut-list">
            <div v-for="item in group.items" :key="`${group.title}-${item.description}`" class="shortcut-row">
              <dt>
                <kbd v-for="key in item.keys" :key="key">{{ key }}</kbd>
              </dt>
              <dd>{{ item.description }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </article>
  </section>
</template>

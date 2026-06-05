<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { getPathLabel } from '../file-manager/formatters'
import type { FocusState, TerminalPaneState, TerminalTabState } from '../file-manager/types'
import TerminalTabView from './TerminalTabView.vue'

const props = defineProps<{
  pane: TerminalPaneState
  focusState: FocusState
}>()

const emit = defineEmits<{
  focus: [paneId: string]
  switchTab: [pane: TerminalPaneState, tabId: string]
  closeTab: [pane: TerminalPaneState, tabId: string]
  createTab: [pane: TerminalPaneState]
}>()

const activeTab = computed(() => props.pane.tabs.find((tab) => tab.id === props.pane.activeTabId) ?? props.pane.tabs[0])

const getTabTitle = (tab: TerminalTabState): string => tab.title || getPathLabel(tab.cwd) || 'Terminal'

const activatePane = async (): Promise<void> => {
  emit('focus', props.pane.id)
  await nextTick()
  document.querySelector<HTMLElement>(`[data-terminal-tab-id="${activeTab.value?.id}"]`)?.focus()
}
</script>

<template>
  <section
    class="file-pane terminal-pane"
    :class="{
      'is-active': focusState === 'primary',
      'is-secondary': focusState === 'secondary',
      'is-closing': pane.isClosing,
      'is-entering-from-right': pane.enterFrom === 'right',
      'is-entering-from-bottom': pane.enterFrom === 'bottom'
    }"
    :data-pane-id="pane.id"
    @mousedown="activatePane"
  >
    <nav class="tab-strip" aria-label="终端标签页">
      <button
        v-for="paneTab in pane.tabs"
        :key="paneTab.id"
        class="tab-button"
        :class="{ active: pane.activeTabId === paneTab.id }"
        type="button"
        :title="paneTab.cwd"
        @click="emit('switchTab', pane, paneTab.id)"
      >
        <span class="tab-title">{{ getTabTitle(paneTab) }}</span>
        <span
          class="tab-close"
          role="button"
          tabindex="-1"
          title="关闭标签页"
          @click.stop="emit('closeTab', pane, paneTab.id)"
        >
          ×
        </span>
      </button>
      <button class="tab-add" type="button" title="新建终端标签页" @click="emit('createTab', pane)">+</button>
    </nav>

    <section class="terminal-tabs">
      <TerminalTabView
        v-for="paneTab in pane.tabs"
        :key="paneTab.id"
        :tab="paneTab"
        :active="pane.activeTabId === paneTab.id"
        v-show="pane.activeTabId === paneTab.id"
      />
      <div v-if="activeTab?.exitMessage" class="terminal-exit">{{ activeTab.exitMessage }}</div>
    </section>
  </section>
</template>

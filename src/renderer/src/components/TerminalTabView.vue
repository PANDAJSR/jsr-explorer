<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getPathLabel } from '../file-manager/formatters'
import type { TerminalTabState } from '../file-manager/types'

const props = defineProps<{
  tab: TerminalTabState
  active: boolean
}>()

const container = ref<HTMLElement | null>(null)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let stopData: (() => void) | null = null
let stopExit: (() => void) | null = null

const fit = (): void => {
  if (!terminal || !fitAddon || !container.value || container.value.offsetParent === null) {
    return
  }

  fitAddon.fit()

  if (props.tab.terminalId) {
    void window.electron.terminal.resize(props.tab.terminalId, terminal.cols, terminal.rows)
  }
}

onMounted(async () => {
  terminal = new Terminal({
    cursorBlink: true,
    fontFamily:
      '"SourceCodePro+Powerline+Awesome", "Source Code Pro for Powerline", "SourceCodePro Nerd Font", "SourceCodePro Nerd Font Mono", "JetBrainsMono Nerd Font", "JetBrainsMono Nerd Font Mono", "JetBrainsMonoNL Nerd Font", "JetBrainsMonoNL Nerd Font Mono", "JetBrainsMono NFM", "JetBrainsMonoNL NFM", "MesloLGS NF", "MesloLGS Nerd Font Mono", "Hack Nerd Font Mono", "Symbols Nerd Font Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    theme: {
      background: '#111820',
      foreground: '#e5edf5',
      cursor: '#ffffff',
      selectionBackground: '#35506a'
    }
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  if (!container.value) {
    return
  }

  terminal.open(container.value)
  terminal.onData((data) => {
    if (props.tab.terminalId) {
      window.electron.terminal.write(props.tab.terminalId, data)
    }
  })
  terminal.onTitleChange((title) => {
    props.tab.title = title || getPathLabel(props.tab.cwd) || 'Terminal'
  })

  stopData = window.electron.terminal.onData((terminalId, data) => {
    if (terminalId === props.tab.terminalId) {
      terminal?.write(data)
    }
  })
  stopExit = window.electron.terminal.onExit((terminalId, exit) => {
    if (terminalId === props.tab.terminalId) {
      props.tab.exitMessage = `进程已退出 (${exit.exitCode ?? 'signal'}${exit.signal ? `, ${exit.signal}` : ''})`
    }
  })

  resizeObserver = new ResizeObserver(() => fit())
  resizeObserver.observe(container.value)

  await nextTick()
  fit()

  try {
    props.tab.terminalId = props.tab.id
    const session = await window.electron.terminal.create({
      id: props.tab.id,
      cwd: props.tab.cwd,
      cols: terminal.cols,
      rows: terminal.rows
    })
    props.tab.terminalId = session.id
    props.tab.cwd = session.cwd
    props.tab.title = getPathLabel(session.cwd) || session.shellName || 'Terminal'
    terminal.focus()
  } catch (error) {
    props.tab.terminalId = null
    const message = error instanceof Error ? error.message : '无法启动终端。'
    props.tab.exitMessage = message
    terminal.writeln(`无法启动终端：${message}`)
  }
})

watch(
  () => props.active,
  async (isActive) => {
    if (!isActive) {
      return
    }

    await nextTick()
    fit()
    terminal?.focus()
  }
)

onBeforeUnmount(() => {
  stopData?.()
  stopExit?.()
  resizeObserver?.disconnect()
  terminal?.dispose()

  if (props.tab.terminalId) {
    void window.electron.terminal.dispose(props.tab.terminalId)
  }
})
</script>

<template>
  <div ref="container" class="terminal-instance" :data-terminal-tab-id="tab.id" tabindex="-1"></div>
</template>

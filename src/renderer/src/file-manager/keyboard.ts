import type { Ref } from 'vue'
import type { MoveDirection, Platform, SplitDirection } from './types'

type KeyboardActions = {
  copySelectedToSecondary: () => void
  createTab: () => void
  closeTab: () => void
  copy: () => void
  goBack: () => void
  goForward: () => void
  goUp: () => void
  cut: () => void
  newFolder: () => void
  moveFocus: (direction: MoveDirection) => void
  moveSelection: (direction: 'previous' | 'next', extendSelection: boolean) => void
  openSelected: () => void
  paste: () => void
  rename: () => void
  splitPane: (direction: SplitDirection) => void
  trash: () => void
}

const isTextEditingEvent = (event: KeyboardEvent): boolean => {
  const target = event.target

  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

export const createKeyboardHandler = (platform: Ref<Platform>, actions: KeyboardActions) => {
  return (event: KeyboardEvent): void => {
    const primaryModifier = platform.value === 'darwin' ? event.metaKey : event.ctrlKey

    if (!isTextEditingEvent(event) && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey) {
      if (!primaryModifier) {
        event.preventDefault()
        actions.moveSelection(event.key === 'ArrowDown' ? 'next' : 'previous', event.shiftKey)
        return
      }
    }

    if (event.altKey) {
      const directionByKey: Partial<Record<string, MoveDirection>> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down'
      }
      const direction = directionByKey[event.key]

      if (direction) {
        event.preventDefault()
        actions.moveFocus(direction)
        return
      }
    }

    if (event.shiftKey && event.key.toLowerCase() === 'r' && !isTextEditingEvent(event)) {
      event.preventDefault()
      actions.rename()
      return
    }

    if (event.shiftKey && event.key.toLowerCase() === 'f' && !isTextEditingEvent(event)) {
      event.preventDefault()
      actions.newFolder()
      return
    }

    if (event.shiftKey && event.key === 'Backspace' && !isTextEditingEvent(event)) {
      event.preventDefault()
      actions.trash()
      return
    }

    if (!primaryModifier || isTextEditingEvent(event)) {
      return
    }

    if (event.key === '[') {
      event.preventDefault()
      actions.goBack()
      return
    }

    if (event.key === ']') {
      event.preventDefault()
      actions.goForward()
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      actions.goUp()
      return
    }

    if (event.key.toLowerCase() === 'o') {
      event.preventDefault()
      actions.openSelected()
      return
    }

    if (event.key.toLowerCase() === 'c' && !event.shiftKey) {
      event.preventDefault()
      actions.copy()
      return
    }

    if (event.key.toLowerCase() === 'v') {
      event.preventDefault()
      actions.paste()
      return
    }

    if (event.key.toLowerCase() === 'x') {
      event.preventDefault()
      actions.cut()
      return
    }

    if (event.key.toLowerCase() === 'd') {
      event.preventDefault()
      actions.splitPane(event.shiftKey ? 'vertical' : 'horizontal')
      return
    }

    if (event.key.toLowerCase() === 't') {
      event.preventDefault()
      actions.createTab()
      return
    }

    if (event.key.toLowerCase() === 'w') {
      event.preventDefault()
      actions.closeTab()
      return
    }

    if (event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      actions.copySelectedToSecondary()
      return
    }

  }
}

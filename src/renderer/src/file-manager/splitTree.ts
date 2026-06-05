import type { SplitNode } from './types'

export const findFirstPaneId = (node: SplitNode): string => {
  if (node.type === 'pane') {
    return node.paneId
  }

  return findFirstPaneId(node.children[0])
}

export const replacePaneNode = (node: SplitNode, paneId: string, replacement: SplitNode): SplitNode => {
  if (node.type === 'pane') {
    return node.paneId === paneId ? replacement : node
  }

  return {
    ...node,
    children: [
      replacePaneNode(node.children[0], paneId, replacement),
      replacePaneNode(node.children[1], paneId, replacement)
    ]
  }
}

export const removePaneNode = (node: SplitNode, paneId: string): SplitNode | null => {
  if (node.type === 'pane') {
    return node.paneId === paneId ? null : node
  }

  const first = removePaneNode(node.children[0], paneId)
  const second = removePaneNode(node.children[1], paneId)

  if (!first && !second) {
    return null
  }

  if (!first) {
    return second
  }

  if (!second) {
    return first
  }

  return {
    ...node,
    children: [first, second]
  }
}

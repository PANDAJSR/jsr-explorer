import type { MoveDirection, PaneState } from './types'

export const getDirectionalPaneId = (
  focusedPaneId: string,
  panes: Record<string, PaneState>,
  direction: MoveDirection
): string | null => {
  const focusedElement = document.querySelector<HTMLElement>(`[data-pane-id="${focusedPaneId}"]`)

  if (!focusedElement) {
    return null
  }

  const focusedRect = focusedElement.getBoundingClientRect()
  const focusedCenterX = focusedRect.left + focusedRect.width / 2
  const focusedCenterY = focusedRect.top + focusedRect.height / 2
  const candidates = [...document.querySelectorAll<HTMLElement>('[data-pane-id]')]
    .filter((element) => element.dataset.paneId && element.dataset.paneId !== focusedPaneId)
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const horizontalDistance = centerX - focusedCenterX
      const verticalDistance = centerY - focusedCenterY
      const pane = panes[element.dataset.paneId ?? '']
      const isCandidate =
        Boolean(pane) &&
        !pane.isClosing &&
        ((direction === 'left' && horizontalDistance < 0) ||
          (direction === 'right' && horizontalDistance > 0) ||
          (direction === 'up' && verticalDistance < 0) ||
          (direction === 'down' && verticalDistance > 0))

      return {
        paneId: element.dataset.paneId ?? '',
        isCandidate,
        primaryDistance: direction === 'left' || direction === 'right' ? Math.abs(horizontalDistance) : Math.abs(verticalDistance),
        crossDistance: direction === 'left' || direction === 'right' ? Math.abs(verticalDistance) : Math.abs(horizontalDistance)
      }
    })
    .filter((candidate) => candidate.isCandidate)
    .sort((left, right) => left.primaryDistance + left.crossDistance * 0.4 - (right.primaryDistance + right.crossDistance * 0.4))

  return candidates[0]?.paneId ?? null
}

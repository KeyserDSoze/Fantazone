import { create } from 'zustand'
import type { ConnectivityState } from './networkStatus'

export type OperationStatusState = {
  busy: boolean
  title: string | null
  detail: string | null
  connectivity: ConnectivityState
  pendingWrites: number
  lastSyncedAt: string | null
  setBusy: (busy: boolean, title?: string | null, detail?: string | null) => void
  setDetail: (detail: string | null) => void
  setConnectivity: (connectivity: ConnectivityState) => void
  setPendingWrites: (pendingWrites: number) => void
  markSynced: () => void
}

export const useOperationStatus = create<OperationStatusState>(set => ({
  busy: false,
  title: null,
  detail: null,
  connectivity: 'unknown',
  pendingWrites: 0,
  lastSyncedAt: null,
  setBusy: (busy, title = null, detail = null) => set({ busy, title, detail }),
  setDetail: detail => set({ detail }),
  setConnectivity: connectivity => set({ connectivity }),
  setPendingWrites: pendingWrites => set({ pendingWrites: Math.max(0, pendingWrites) }),
  markSynced: () => set({ connectivity: 'online', lastSyncedAt: new Date().toISOString() }),
}))

export function beginOperation(title: string, detail: string): void {
  useOperationStatus.getState().setBusy(true, title, detail)
}

export function updateOperation(detail: string): void {
  useOperationStatus.getState().setDetail(detail)
}

export function endOperation(): void {
  useOperationStatus.getState().setBusy(false, null, null)
}

export function markConnectivity(connectivity: ConnectivityState): void {
  useOperationStatus.getState().setConnectivity(connectivity)
}

export function setPendingWrites(count: number): void {
  useOperationStatus.getState().setPendingWrites(count)
}

export function markSynced(): void {
  useOperationStatus.getState().markSynced()
}

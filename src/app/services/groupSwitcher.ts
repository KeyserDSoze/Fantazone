const MANUAL_GROUP_SWITCH_KEY = 'fantazone_manual_group_switch_v1'
let nativeManualSwitchPending = false

/** Mark that the next group picker was opened intentionally from inside a group. */
export function markManualGroupSwitchRequest(): void {
  nativeManualSwitchPending = true
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(MANUAL_GROUP_SWITCH_KEY, '1')
  } catch {
    // Native/no-storage environments use the in-memory flag.
  }
}

/** Consume one intentional switch request so automatic default opening is skipped once. */
export function consumeManualGroupSwitchRequest(): boolean {
  let pending = nativeManualSwitchPending
  nativeManualSwitchPending = false
  try {
    if (typeof sessionStorage !== 'undefined') {
      pending = pending || sessionStorage.getItem(MANUAL_GROUP_SWITCH_KEY) === '1'
      sessionStorage.removeItem(MANUAL_GROUP_SWITCH_KEY)
    }
  } catch {
    // Native/no-storage environments use the in-memory flag.
  }
  return pending
}

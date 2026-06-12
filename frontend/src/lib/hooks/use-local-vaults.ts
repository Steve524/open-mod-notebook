'use client'

import { useEffect, useState } from 'react'
import { getConfig } from '@/lib/config'

/**
 * Whether the shelved server-side disk vault model is enabled on the backend
 * (OPEN_NOTEBOOK_ENABLE_LOCAL_VAULTS). Defaults to false until config loads, so
 * the disk-only browse/validate/link UI stays hidden by default; the supported
 * path is the Obsidian push plugin.
 */
export function useLocalVaultsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let active = true
    getConfig()
      .then((c) => {
        if (active) setEnabled(!!c.localVaults)
      })
      .catch(() => {
        /* config unreachable -> keep disk UI hidden */
      })
    return () => {
      active = false
    }
  }, [])
  return enabled
}

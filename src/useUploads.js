import { useSyncExternalStore } from 'react'
import { getUploads, subscribeUploads } from './uploadQueue.js'

// The background uploads (uploadQueue.js) for the UI: { items, status,
// error, fraction }.
export function useUploads() {
  return useSyncExternalStore(subscribeUploads, getUploads)
}

import type { ProjectSnapshot } from '../../types/project'
import type { AssetStore } from './assetStore'
import { referencedAssetIds } from './audit'

/** Remove only assets proven unreferenced by a committed project snapshot. */
export async function collectOrphanAssets(
  store: AssetStore, projectId: string, snapshot: ProjectSnapshot,
  protectedIds: ReadonlySet<string> = new Set(), now = Date.now(), graceMs = 2 * 60 * 1000,
): Promise<string[]> {
  const referenced = referencedAssetIds(snapshot)
  const removed: string[] = []
  for (const asset of await store.list(projectId)) {
    if (referenced.has(asset.id) || protectedIds.has(asset.id) || now - asset.createdAt < graceMs) continue
    await store.remove(asset.id)
    removed.push(asset.id)
  }
  return removed
}

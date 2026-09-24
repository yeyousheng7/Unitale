import { inject, type InjectionKey } from 'vue'
import type { useUnitaleWorkspace } from '../composables/useUnitaleWorkspace'

export type WorkspaceContext = ReturnType<typeof useUnitaleWorkspace>

export const workspaceKey: InjectionKey<WorkspaceContext> = Symbol('unitale-workspace')

export function useWorkspace(): WorkspaceContext {
  const workspace = inject(workspaceKey)
  if (!workspace) throw new Error('Unitale workspace is unavailable')
  return workspace
}

// Keep request options and response handling at the call site during migration.
// This boundary can host provider-specific clients after parity has been verified.
export function requestService(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, options)
}

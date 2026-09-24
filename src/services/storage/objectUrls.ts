/** Tracks Blob URLs by the UI owner that needs them. Replacing an owner revokes its old URL. */
export class ObjectUrlManager {
  private urls = new Map<string, string>()

  create(owner: string, blob: Blob): string {
    this.release(owner)
    const url = URL.createObjectURL(blob)
    this.urls.set(owner, url)
    return url
  }

  release(owner: string): void {
    const url = this.urls.get(owner)
    if (url) URL.revokeObjectURL(url)
    this.urls.delete(owner)
  }

  releasePrefix(prefix: string): void {
    for (const owner of [...this.urls.keys()]) if (owner.startsWith(prefix)) this.release(owner)
  }

  releaseAll(): void { for (const owner of [...this.urls.keys()]) this.release(owner) }
  get size(): number { return this.urls.size }
}

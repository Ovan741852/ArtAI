import type { CivitaiModelItem, CivitaiModelVersion } from './civitaiSearchModels.js'

export type CheckpointPickQuality = 'exact_file' | 'stem_file' | 'fuzzy_file' | 'first_search_hit'

export function stemFileName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename
  return base.replace(/\.[^.]+$/, '')
}

function sortVersionsNewestFirst(versions: CivitaiModelVersion[]): CivitaiModelVersion[] {
  return [...versions].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0
    return tb - ta
  })
}

type PickCandidate = {
  item: CivitaiModelItem
  version: CivitaiModelVersion
  quality: CheckpointPickQuality
  rank: number
}

const rankByQuality: Record<CheckpointPickQuality, number> = {
  exact_file: 100,
  stem_file: 80,
  fuzzy_file: 50,
  first_search_hit: 10,
}

/**
 * 依本機 checkpoint 檔名，從 Civitai 搜尋結果挑最可能的一筆 model + version。
 */
export function pickCheckpointFromCivitaiItems(
  checkpointFileName: string,
  items: CivitaiModelItem[],
): { item: CivitaiModelItem; version: CivitaiModelVersion; quality: CheckpointPickQuality } | null {
  if (items.length === 0) return null

  const fullLc = checkpointFileName.trim().toLowerCase()
  const stemLc = stemFileName(checkpointFileName).toLowerCase()

  const candidates: PickCandidate[] = []

  for (const item of items) {
    const versions = sortVersionsNewestFirst(item.modelVersions ?? [])
    for (const v of versions) {
      for (const f of v.files ?? []) {
        const fn = (f.name ?? '').toLowerCase()
        if (fn && fn === fullLc) {
          candidates.push({ item, version: v, quality: 'exact_file', rank: rankByQuality.exact_file })
        } else if (fn && stemFileName(fn).toLowerCase() === stemLc) {
          candidates.push({ item, version: v, quality: 'stem_file', rank: rankByQuality.stem_file })
        } else if (fn && stemLc) {
          const sn = stemFileName(fn).toLowerCase()
          if (sn && (fn.includes(stemLc) || stemLc.includes(sn))) {
            candidates.push({ item, version: v, quality: 'fuzzy_file', rank: rankByQuality.fuzzy_file })
          }
        }
      }
    }
  }

  if (candidates.length > 0) {
    const best = candidates.reduce((a, b) => (b.rank > a.rank ? b : a))
    return { item: best.item, version: best.version, quality: best.quality }
  }

  const first = items[0]
  const v0 = sortVersionsNewestFirst(first.modelVersions ?? [])[0]
  if (!v0) return null
  return { item: first, version: v0, quality: 'first_search_hit' }
}

import type { CheckpointTagAssistantLocalRow } from '../../net'

export type CheckpointLocalPresence =
  | 'hidden'
  /** 本機 Comfy 清單列：檔在，且 checkpoint 目錄有對應條目。 */
  | 'local-in-catalog'
  /** 本機 Comfy 清單列：檔在，但目錄尚無條目。 */
  | 'local-no-catalog'
  /** Civitai 建議列：與本機清單比對後判定已安裝。 */
  | 'match-installed'
  /** Civitai 建議列：未在本機清單中找到對應。 */
  | 'match-missing'

const EXT = /\.(safetensors|safetensors\.gz|ckpt|pt|pth|bin)$/i

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(EXT, '')
    .replace(/[\s_-]+/g, '')
}

/**
 * 以本機 `localCheckpoints` 比對 Civitai 建議名稱（檔名主幹或目錄內 Civitai 模型名）。
 */
export function resolveRecommendedLocalPresence(
  recommendedName: string,
  localRows: readonly CheckpointTagAssistantLocalRow[],
): 'match-installed' | 'match-missing' {
  const t = norm(recommendedName)
  if (!t) return 'match-missing'
  for (const row of localRows) {
    const catName = row.civitaiModelName?.trim()
    if (catName && norm(catName) === t) return 'match-installed'
    const base = norm(row.localFilename)
    if (base && base === t) return 'match-installed'
    if (base && t.length >= 4 && base.length >= 4 && (base.includes(t) || t.includes(base))) return 'match-installed'
  }
  return 'match-missing'
}

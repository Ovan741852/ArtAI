import { stripHtml } from '../lib/stripHtml.js'
import type { CivitaiModelItem } from './civitaiSearchModels.js'

export type CivitaiModelRow = {
  id: number
  name: string
  type: string | undefined
  nsfw: boolean | undefined
  tags: string[] | undefined
  creatorUsername: string | undefined
  stats: Record<string, unknown> | undefined
  descriptionText: string
  descriptionHtml: string | null
  modelVersionsPreview: Array<{
    id: number
    name: string | undefined
    baseModel: string | undefined
    trainedWords: string[]
    descriptionText: string
  }>
  civitaiUrl: string
}

export function mapCivitaiModelRow(item: CivitaiModelItem): CivitaiModelRow {
  const versions = (item.modelVersions ?? []).slice(0, 5).map((v) => ({
    id: v.id,
    name: v.name,
    baseModel: v.baseModel,
    trainedWords: v.trainedWords ?? [],
    descriptionText: stripHtml(v.description ?? ''),
  }))

  return {
    id: item.id,
    name: item.name,
    type: item.type,
    nsfw: item.nsfw,
    tags: item.tags,
    creatorUsername: item.creator?.username,
    stats: item.stats,
    descriptionText: stripHtml(item.description ?? ''),
    descriptionHtml: item.description ?? null,
    modelVersionsPreview: versions,
    civitaiUrl: `https://civitai.com/models/${item.id}`,
  }
}

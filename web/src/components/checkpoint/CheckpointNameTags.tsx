import type { ReactNode } from 'react'

import type { CheckpointLocalPresence } from './checkpointLocalPresence'
import './checkpointNameTags.css'

export type { CheckpointLocalPresence } from './checkpointLocalPresence'

export type CheckpointNameTagsProps = {
  /**
   * 主標題：本機 checkpoint 檔名、Civitai 模型名，或僅作無障礙用語意（搭配 `showTitle={false}`）。
   */
  name: string
  /** Civitai model tags（多為英文）。 */
  tags?: readonly string[]
  /** 顯示在檔名下方的一行說明（字串或小元件皆可）。 */
  caption?: ReactNode
  /** 檔名列右側（例如按鈕）。 */
  trailing?: ReactNode
  /** 無 tags 時顯示；未傳則不顯示該列。 */
  emptyHint?: string
  /**
   * 為 false 時不顯示檔名列（`name` 仍用於 `aria-label`），並改為先顯示 tags 再顯示 caption；適用「僅一組建議 tags」區塊。
   * @default true
   */
  showTitle?: boolean
  className?: string
  /**
   * 本機／目錄／與建議清單比對狀態。預設不顯示。
   * @default 'hidden'
   */
  localPresence?: CheckpointLocalPresence
}

/**
 * 共用：checkpoint 檔名 + tag chips。之後所有 checkpoint 列表應優先使用此元件。
 */
const PRESENCE_LABEL: Record<Exclude<CheckpointLocalPresence, 'hidden'>, string> = {
  'local-in-catalog': '目錄已對應',
  'local-no-catalog': '未入目錄',
  'match-installed': '本機已有',
  'match-missing': '本機未安裝',
}

const PRESENCE_CLASS: Record<Exclude<CheckpointLocalPresence, 'hidden'>, string> = {
  'local-in-catalog': 'cknt__pill--ok',
  'local-no-catalog': 'cknt__pill--warn',
  'match-installed': 'cknt__pill--ok',
  'match-missing': 'cknt__pill--muted',
}

export function CheckpointNameTags(props: CheckpointNameTagsProps) {
  const { name, tags = [], caption, trailing, emptyHint, showTitle = true, className, localPresence = 'hidden' } = props
  const list = [...tags]
  const rootClass = ['cknt', !showTitle ? 'cknt--tags-only' : '', className].filter(Boolean).join(' ')

  const presenceBlock =
    localPresence !== 'hidden' ? (
      <span className={`cknt__pill ${PRESENCE_CLASS[localPresence]}`}>{PRESENCE_LABEL[localPresence]}</span>
    ) : null

  const tagsBlock =
    list.length > 0 ? (
      <div className="cknt__tags" aria-label="Tags">
        {list.map((t, ti) => (
          <span key={`${String(ti)}-${t}`} className="cknt__tag">
            {t}
          </span>
        ))}
      </div>
    ) : emptyHint ? (
      <p className="cknt__empty">{emptyHint}</p>
    ) : null

  const captionBlock =
    caption != null && caption !== '' ? <div className="cknt__caption">{caption}</div> : null

  return (
    <div className={rootClass} aria-label={showTitle ? undefined : name}>
      {showTitle ? (
        <>
          <div className="cknt__row">
            <span className="cknt__name">{name}</span>
            {presenceBlock}
            {trailing}
          </div>
          {captionBlock}
          {tagsBlock}
        </>
      ) : (
        <>
          {presenceBlock ? <div className="cknt__row cknt__row--presence-only">{presenceBlock}</div> : null}
          {tagsBlock}
          {captionBlock}
        </>
      )}
    </div>
  )
}

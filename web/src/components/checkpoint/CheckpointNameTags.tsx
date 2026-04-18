import type { ReactNode } from 'react'

import './checkpointNameTags.css'

export type CheckpointNameTagsProps = {
  /** Checkpoint 檔名（含副檔名）。 */
  name: string
  /** Civitai model tags（多為英文）。 */
  tags?: readonly string[]
  /** 顯示在檔名下方的一行說明（字串或小元件皆可）。 */
  caption?: ReactNode
  /** 檔名列右側（例如按鈕）。 */
  trailing?: ReactNode
  /** 無 tags 時顯示；未傳則不顯示該列。 */
  emptyHint?: string
  className?: string
}

/**
 * 共用：checkpoint 檔名 + tag chips。之後所有 checkpoint 列表應優先使用此元件。
 */
export function CheckpointNameTags(props: CheckpointNameTagsProps) {
  const { name, tags = [], caption, trailing, emptyHint, className } = props
  const list = [...tags]
  const rootClass = ['cknt', className].filter(Boolean).join(' ')

  return (
    <div className={rootClass}>
      <div className="cknt__row">
        <span className="cknt__name">{name}</span>
        {trailing}
      </div>
      {caption != null && caption !== '' ? <div className="cknt__caption">{caption}</div> : null}
      {list.length > 0 ? (
        <div className="cknt__tags" aria-label="Tags">
          {list.map((t) => (
            <span key={t} className="cknt__tag">
              {t}
            </span>
          ))}
        </div>
      ) : emptyHint ? (
        <p className="cknt__empty">{emptyHint}</p>
      ) : null}
    </div>
  )
}

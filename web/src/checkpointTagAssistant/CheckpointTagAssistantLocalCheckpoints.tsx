import { CheckpointNameTags } from '../components/checkpoint/CheckpointNameTags'
import type { CheckpointTagAssistantOkData } from '../net'

export type CheckpointTagAssistantLocalCheckpointsProps = {
  localRows: CheckpointTagAssistantOkData['localCheckpoints']
  dumpLoading: boolean
  dumpError: string | null
}

export function CheckpointTagAssistantLocalCheckpoints(props: CheckpointTagAssistantLocalCheckpointsProps) {
  const { localRows, dumpLoading, dumpError } = props

  return (
    <div className="cta-local">
      <h3 className="cta-local__title">本機 checkpoints</h3>
      {dumpError ? <p className="cta__err">{dumpError}</p> : null}
      <div className="cta-local__scroll">
        {dumpLoading ? (
          <p className="cta__hint">載入清單中…</p>
        ) : localRows.length === 0 ? (
          <p className="cta__hint">目前沒有從 Comfy 讀到 checkpoint 檔；請確認後端已設定 Comfy 位址，或先到「本機模型彙整」同步目錄。</p>
        ) : (
          localRows.map((row) => (
            <div key={row.localFilename} className="cta-local__row">
              <CheckpointNameTags
                name={row.localFilename}
                tags={row.civitaiTags}
                localPresence={row.inCatalog ? 'local-in-catalog' : 'local-no-catalog'}
                caption={row.civitaiModelName ? `Civitai：${row.civitaiModelName}` : null}
                emptyHint={
                  row.inCatalog ? '(no tags in catalog)' : '（尚未寫入目錄 — 可到本機模型彙整按「同步 checkpoint 目錄」）'
                }
              />
              {!row.inCatalog ? <p className="cta__local-meta">Not in synced catalog</p> : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

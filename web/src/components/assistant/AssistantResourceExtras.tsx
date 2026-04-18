import { CheckpointNameTags } from '../checkpoint/CheckpointNameTags'
import { resolveRecommendedLocalPresence } from '../checkpoint/checkpointLocalPresence'
import type { AssistantResourceExtraOk } from '../../net/protocol/assistantResourceExtras'
import type { CheckpointTagAssistantLocalRow } from '../../net/protocol/checkpointTagAssistant'
import './assistantResourceExtras.css'

const KIND_LABEL: Record<AssistantResourceExtraOk['kind'], string> = {
  lora: 'LoRA',
  textual_inversion: 'Embedding',
  controlnet: 'ControlNet',
  workflow: '流程／工具',
}

export type AssistantResourceExtrasProps = {
  extras: AssistantResourceExtraOk[]
  /** 若提供，Civitai 建議列會比對本機 checkpoint 檔名（模型套組 panel 可省略）。 */
  localRows?: readonly CheckpointTagAssistantLocalRow[]
}

export function AssistantResourceExtras(props: AssistantResourceExtrasProps) {
  const { extras, localRows } = props
  if (extras.length === 0) return null

  return (
    <section className="arex" aria-label="延伸資源與 Civitai 建議">
      <h4 className="arex__title">延伸資源</h4>
      {extras.map((row, i) => (
        <article key={`${row.kind}-${String(i)}-${row.titleZh.slice(0, 12)}`} className="arex__row">
          <div className="arex__row-head">
            <span className="arex__kind">{KIND_LABEL[row.kind]}</span>
            <h5 className="arex__heading">{row.titleZh}</h5>
          </div>
          {row.detailZh ? (
            <p className="arex__detail">{row.detailZh}</p>
          ) : null}
          {(row.modelTags.length > 0 || row.searchQueries.length > 0) && (
            <CheckpointNameTags
              className="cta__hist-tagblock"
              name={`${KIND_LABEL[row.kind]} 搜尋條件`}
              showTitle={false}
              tags={row.modelTags}
              caption={
                row.searchQueries.length > 0 ? <>Civitai：{row.searchQueries.join(' · ')}</> : null
              }
              emptyHint="(無)"
            />
          )}
          {row.recommendedModels.length > 0 ? (
            <div className="arex__rec">
              {row.recommendedModels.map((m) => (
                <div key={m.id} className="arex__rec-card">
                  <CheckpointNameTags
                    name={m.name}
                    tags={m.tags}
                    localPresence={
                      localRows ? resolveRecommendedLocalPresence(m.name, localRows) : undefined
                    }
                    emptyHint="(no tags)"
                    caption={
                      <a href={m.civitaiUrl} target="_blank" rel="noreferrer">
                        Civitai · #{m.id}
                      </a>
                    }
                  />
                  {m.descriptionText ? <p className="arex__rec-desc">{m.descriptionText}</p> : null}
                </div>
              ))}
            </div>
          ) : row.kind === 'lora' || row.kind === 'textual_inversion' ? (
            <p className="cta__muted">此類別目前無 Civitai 搜尋結果。</p>
          ) : null}
        </article>
      ))}
    </section>
  )
}

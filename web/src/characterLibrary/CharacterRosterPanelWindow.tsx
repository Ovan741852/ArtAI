import { resolveArtaiApiPath } from '../net'
import { useCharacterLibraryBrowser } from './useCharacterLibraryBrowser'

import './characterRosterPanel.css'

/**
 * 角色總覽：卡片列表、點開看圖與說明、可加入參考圖。
 * 與「角色庫」共用 {@link useCharacterLibraryBrowser}（兩區狀態各自獨立）。
 */
export function CharacterRosterPanelWindow() {
  const b = useCharacterLibraryBrowser()

  const toggleRow = (id: string) => {
    b.setErr(null)
    b.setSelectedId(b.selectedId === id ? null : id)
  }

  return (
    <section className="croster" aria-label="角色總覽">
      <header className="croster__head">
        <h2 className="croster__title">角色總覽</h2>
        <p className="croster__lead">
          查看目前已建立的角色；點開可看參考圖與文字說明，並可<strong>加入更多參考圖</strong>（會與錨點比對是否像同一人）。若要<strong>新建角色</strong>請使用下方「角色庫」區塊。
        </p>
      </header>

      {b.err ? (
        <p className="croster__err" role="alert">
          {b.err}
        </p>
      ) : null}

      <div className="croster__row">
        <button type="button" className="croster__btn" disabled={b.loadingList} onClick={() => void b.loadList()}>
          {b.loadingList ? '載入中…' : '重新整理'}
        </button>
        <label className="croster__meta">
          審圖用 Ollama 模型
          <select
            className="croster__input"
            style={{ marginLeft: 8 }}
            value={b.ollamaPicked}
            onChange={(ev) => b.setOllamaPicked(ev.target.value)}
            disabled={b.ollamaNames.length === 0}
          >
            {b.ollamaNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {b.ollamaErr ? <span className="croster__meta">{b.ollamaErr}</span> : null}
      </div>

      {b.list.length === 0 ? (
        <p className="croster__lead">尚無角色。請到下方「角色庫」上傳錨點照片建立第一位角色。</p>
      ) : (
        <div className="croster__grid">
          {b.list.map((row) => {
            const isOpen = b.selectedId === row.id
            const detailForRow =
              isOpen && !b.loadingDetail && b.detail != null && b.detail.human.id === row.id ? b.detail : null
            return (
              <article key={row.id} className="croster__card">
                <button
                  type="button"
                  className={`croster__card-head${isOpen ? ' croster__card-head--open' : ''}`}
                  onClick={() => toggleRow(row.id)}
                  aria-expanded={isOpen}
                >
                  <h3 className="croster__name">{row.displayName?.trim() || '（未命名）'}</h3>
                  <span className="croster__meta">
                    {row.imageCount} 張參考圖
                    {row.summaryZh ? ` · ${row.summaryZh.slice(0, 56)}${row.summaryZh.length > 56 ? '…' : ''}` : ' · 尚無摘要'}
                  </span>
                  <span className="croster__meta">{isOpen ? '點擊收合' : '點擊展開'}</span>
                </button>
                {isOpen ? (
                  <div className="croster__card-body">
                    {b.loadingDetail ? <p className="croster__lead">載入詳情中…</p> : null}
                    {!b.loadingDetail && isOpen && detailForRow == null ? (
                      <p className="croster__lead">無法載入此角色。</p>
                    ) : null}
                    {detailForRow ? (
                      <>
                        <div className="croster__text-block">
                          <h4>文字說明</h4>
                          {detailForRow.human.summaryZh ? (
                            <p>{detailForRow.human.summaryZh}</p>
                          ) : (
                            <p>
                              尚未產生摘要。可按下方「產生／更新文字摘要」，或到「角色庫」同一角色區按「整理摘要（profile）」。
                            </p>
                          )}
                          {detailForRow.machine.profileMergedAt ? (
                            <p className="croster__hint">摘要更新時間：{detailForRow.machine.profileMergedAt}</p>
                          ) : null}
                        </div>

                        <div className="croster__gallery" role="list">
                          {detailForRow.machine.images.map((im) => (
                            <figure key={im.id} className="croster__fig" role="listitem">
                              <img
                                src={resolveArtaiApiPath(im.filePath)}
                                alt={im.isAnchor ? '錨點參考圖' : '參考圖'}
                                loading="lazy"
                              />
                              <figcaption>{im.isAnchor ? '錨點（第一張）' : '參考圖'}</figcaption>
                            </figure>
                          ))}
                        </div>

                        {detailForRow.machine.profileEn && Object.keys(detailForRow.machine.profileEn).length > 0 ? (
                          <details className="croster__details">
                            <summary>給系統看的細節（英文 JSON，可摺疊）</summary>
                            <pre className="croster__pre">{JSON.stringify(detailForRow.machine.profileEn, null, 2)}</pre>
                          </details>
                        ) : null}

                        <div className="croster__row" style={{ marginTop: 16 }}>
                          <input
                            ref={b.addFileRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            hidden
                            onChange={b.onAddFileChange}
                          />
                          <button
                            type="button"
                            className="croster__btn croster__btn--accent"
                            disabled={b.busy}
                            onClick={() => b.addFileRef.current?.click()}
                          >
                            {b.busy ? '處理中…' : '嘗試加入參考圖'}
                          </button>
                          <button type="button" className="croster__btn" disabled={b.busy} onClick={() => void b.onProfileRefresh()}>
                            產生／更新文字摘要
                          </button>
                          <span className="croster__meta">單檔上限 8 MB；加圖需與錨點為同一人。</span>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

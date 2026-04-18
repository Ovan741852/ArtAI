import { resolveArtaiApiPath } from '../net'
import { useCharacterLibraryBrowser } from './useCharacterLibraryBrowser'

import './characterLibrary.css'

export function CharacterLibraryWindow() {
  const b = useCharacterLibraryBrowser()

  return (
    <section className="clib" aria-label="角色庫">
      <header className="clib__head">
        <h2 className="clib__title">角色庫</h2>
        <p className="clib__lead">
          第一張入庫照片為<strong>錨點</strong>；之後加圖會與錨點比對是否像同一人。需本機 Ollama 視覺模型。
        </p>
      </header>

      {b.err ? (
        <p className="clib__err" role="alert">
          {b.err}
        </p>
      ) : null}

      <div className="clib__row">
        <button type="button" className="clib__btn" disabled={b.loadingList} onClick={() => void b.loadList()}>
          {b.loadingList ? '載入中…' : '重新整理列表'}
        </button>
        {b.storeHint ? <span className="clib__meta">{b.storeHint}</span> : null}
      </div>

      <div className="clib__row">
        <label className="clib__meta">
          Ollama 模型
          <select
            className="clib__input"
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
        {b.ollamaErr ? <span className="clib__meta">{b.ollamaErr}</span> : null}
      </div>

      <div className="clib__row">
        <input
          className="clib__input"
          placeholder="顯示名稱（選填）"
          value={b.newDisplayName}
          onChange={(e) => b.setNewDisplayName(e.target.value)}
        />
        <input ref={b.createFileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={b.onCreateFileChange} />
        <button
          type="button"
          className="clib__btn clib__btn--primary"
          disabled={b.busy}
          onClick={() => b.createFileRef.current?.click()}
        >
          建立角色（選一張錨點圖）
        </button>
      </div>

      <div className="clib__split">
        <div>
          <h3 className="clib__title" style={{ fontSize: '1rem' }}>
            角色列表
          </h3>
          {b.list.length === 0 ? (
            <p className="clib__lead">尚無角色。請上傳一張清楚正臉作為錨點。</p>
          ) : (
            <ul className="clib__list">
              {b.list.map((row) => (
                <li key={row.id} className="clib__list-item">
                  <button
                    type="button"
                    className={`clib__list-btn${b.selectedId === row.id ? ' clib__list-btn--active' : ''}`}
                    onClick={() => b.setSelectedId(row.id)}
                  >
                    <strong>{row.displayName?.trim() || '（未命名）'}</strong>
                    <div className="clib__meta">
                      {row.imageCount} 張 · {row.summaryZh ? row.summaryZh.slice(0, 48) : '無摘要'}
                      {row.summaryZh && row.summaryZh.length > 48 ? '…' : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="clib__title" style={{ fontSize: '1rem' }}>
            詳情
          </h3>
          {b.loadingDetail ? <p className="clib__lead">載入中…</p> : null}
          {!b.selectedId ? <p className="clib__lead">請從左側選擇一個角色。</p> : null}
          {b.selectedId && !b.loadingDetail && !b.detail ? <p className="clib__lead">無法載入詳情。</p> : null}
          {b.detail ? (
            <>
              <p className="clib__lead">
                <strong>{b.detail.human.displayName || '（未命名）'}</strong> · {b.detail.human.imageCount} 張
              </p>
              {b.detail.human.summaryZh ? <p className="clib__lead">{b.detail.human.summaryZh}</p> : null}
              <div className="clib__row">
                <input ref={b.addFileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={b.onAddFileChange} />
                <button type="button" className="clib__btn" disabled={b.busy} onClick={() => b.addFileRef.current?.click()}>
                  加一張參考圖
                </button>
                <button type="button" className="clib__btn" disabled={b.busy} onClick={() => void b.onProfileRefresh()}>
                  整理摘要（profile）
                </button>
              </div>
              <div className="clib__thumbs">
                {b.detail.machine.images.map((im) => (
                  <div key={im.id} className="clib__thumb-wrap">
                    <img
                      className="clib__thumb"
                      src={resolveArtaiApiPath(im.filePath)}
                      alt={im.isAnchor ? '錨點' : '參考圖'}
                      loading="lazy"
                    />
                    <span>{im.isAnchor ? '錨點' : '參考'}</span>
                  </div>
                ))}
              </div>
              {b.detail.machine.profileEn && Object.keys(b.detail.machine.profileEn).length > 0 ? (
                <pre className="clib__profile">{JSON.stringify(b.detail.machine.profileEn, null, 2)}</pre>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}

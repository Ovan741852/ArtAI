import './App.css'
import { useCallback, useState } from 'react'
import { CheckpointTagAssistantWindow } from './checkpointTagAssistant/CheckpointTagAssistantWindow'
import { ModelBundleAssistantWindow } from './modelBundleAssistant/ModelBundleAssistantWindow'
import { LocalModelsDumpWindow } from './localModelsDump/LocalModelsDumpWindow'
import { MattingPanelWindow } from './mattingPanel/MattingPanelWindow'
import { CreativeLoopPanelWindow } from './creativeLoopPanel/CreativeLoopPanelWindow'
import { CharacterLibraryWindow } from './characterLibrary/CharacterLibraryWindow'
import { CharacterRosterPanelWindow } from './characterLibrary/CharacterRosterPanelWindow'
import { DemoEchoReq, DemoEchoRsp, createDefaultHttpClient } from './net'
import { useHelloStore } from './store/useHelloStore'

const demoNet = createDefaultHttpClient()

function App() {
  const count = useHelloStore((s) => s.count)
  const increase = useHelloStore((s) => s.increase)
  const reset = useHelloStore((s) => s.reset)
  const [netPreview, setNetPreview] = useState('')

  const runNetDemo = useCallback(async () => {
    const res = await demoNet.sendRequest(DemoEchoReq.allocate('hello'), DemoEchoRsp)
    if (res.ok) {
      setNetPreview(JSON.stringify({ ok: res.data.ok, echo: res.data.echo }, null, 2))
    } else {
      setNetPreview(res.error.message)
    }
  }, [])

  return (
    <div className="app-shell">
      <main className="hello">
        <h1>React + Zustand Hello World</h1>
        <p>Count: {count}</p>
        <div className="hello__actions">
          <button type="button" onClick={increase}>
            +1
          </button>
          <button type="button" onClick={reset}>
            Reset
          </button>
          <button type="button" onClick={runNetDemo}>
            Net demo (echo)
          </button>
        </div>
        {netPreview ? (
          <pre className="hello__net">
            <code>{netPreview}</code>
          </pre>
        ) : null}
      </main>
      <section className="cta-panel" aria-label="Checkpoint 需求助手">
        <CheckpointTagAssistantWindow />
      </section>
      <section className="mba-panel" aria-label="模型套組採購助手">
        <ModelBundleAssistantWindow />
      </section>
      <section className="mat-panel" aria-label="摳圖">
        <MattingPanelWindow />
      </section>
      <section className="cloop-panel" aria-label="創意閉環">
        <CreativeLoopPanelWindow />
      </section>
      <section className="croster-panel" aria-label="角色總覽">
        <CharacterRosterPanelWindow />
      </section>
      <section className="clib-panel" aria-label="角色庫">
        <CharacterLibraryWindow />
      </section>
      <div className="hello hello--tools">
        <LocalModelsDumpWindow />
      </div>
    </div>
  )
}

export default App

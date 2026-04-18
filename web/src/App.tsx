import './App.css'
import { useCallback, useState } from 'react'
import { LocalModelsDumpWindow } from './localModelsDump/LocalModelsDumpWindow'
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
      <LocalModelsDumpWindow />
    </main>
  )
}

export default App

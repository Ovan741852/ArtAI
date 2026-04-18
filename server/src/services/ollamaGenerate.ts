type OllamaGenerateOk = {
  response?: string
}

export async function ollamaGenerateNonStream(params: {
  ollamaBaseUrl: string
  model: string
  prompt: string
}): Promise<string> {
  const base = params.ollamaBaseUrl.replace(/\/+$/, '')
  const url = `${base}/api/generate`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      stream: false,
    }),
  })

  const bodyText = await res.text()
  if (!res.ok) {
    const snippet = bodyText.length > 280 ? `${bodyText.slice(0, 280)}…` : bodyText
    throw new Error(`Ollama generate ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ''}`)
  }

  let data: unknown
  try {
    data = JSON.parse(bodyText) as unknown
  } catch {
    throw new Error('Ollama /api/generate: response is not JSON')
  }

  const rsp = (data as OllamaGenerateOk).response
  if (typeof rsp !== 'string' || rsp.trim() === '') {
    throw new Error('Ollama /api/generate: missing "response" string')
  }

  return rsp
}

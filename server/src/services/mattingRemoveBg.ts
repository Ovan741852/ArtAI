/**
 * Remove.bg HTTP API（需 `REMOVE_BG_API_KEY`）。
 * @see https://www.remove.bg/api
 */

export async function removeBackgroundWithRemoveBg(params: {
  apiKey: string
  imageBytes: Buffer
  mime: string
}): Promise<Buffer> {
  const form = new FormData()
  form.append(
    'image_file',
    new Blob([new Uint8Array(params.imageBytes)], { type: params.mime }),
    'upload',
  )
  form.append('size', 'auto')

  const res = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': params.apiKey },
    body: form,
  })

  const buf = Buffer.from(await res.arrayBuffer())
  if (!res.ok) {
    const snippet = buf.toString('utf8').slice(0, 400)
    throw new Error(`Remove.bg ${String(res.status)}: ${snippet || res.statusText}`)
  }
  return buf
}

import { Hono } from 'hono'

/** 路由層只做 I/O 與狀態碼；業務可再抽到 services（此專案先保持極小）。 */
export const systemRoutes = new Hono()

systemRoutes.get('/', (c) => {
  return c.json({ message: 'Hello World' })
})

systemRoutes.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

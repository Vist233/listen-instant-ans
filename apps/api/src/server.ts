import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApplication } from './bootstrap.js'
import { createHttpServer } from './http/create-http-server.js'

const app = createApplication()
const port = Number(process.env.PORT ?? 3100)
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../../web')

createHttpServer(app, webRoot).listen(port, '127.0.0.1', () => {
  console.log(`ListenInstantAns API listening on http://127.0.0.1:${port}`)
})

// Builds the browser version: one server file plus the web page, runnable with `node server.mjs`.
import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function buildWeb({ outDir = join(root, 'dist', 'web') } = {}) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  await build({
    entryPoints: [join(root, 'apps/api/src/server.ts')],
    outfile: join(outDir, 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
    // Some bundled packages still call require().
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  })
  cpSync(join(root, 'apps/web'), join(outDir, 'public'), {
    recursive: true,
    filter: (source) => !/node_modules|\/test(\/|$)|tsconfig|package\.json/.test(source),
  })
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.1.0'
  writeFileSync(join(outDir, 'package.json'), `${JSON.stringify({ name: 'listen-instant-ans-web', version, type: 'module', private: true, engines: { node: '>=24' }, scripts: { start: 'node server.mjs --open' } }, null, 2)}\n`)
  writeFileSync(join(outDir, 'README.txt'), 'Listen Instant Ans, browser version.\n\nRequires Node.js 24 or newer.\n\n  node server.mjs --open\n\nThen open http://localhost:3100 and fill in the keys under "设置".\n')
  return outDir
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = await buildWeb()
  console.log(`Built the browser version in ${outDir}`)
}

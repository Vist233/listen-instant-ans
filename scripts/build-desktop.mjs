// Builds the macOS app and its .dmg: bundle the program into one file, then let electron-builder wrap it.
//   node scripts/build-desktop.mjs [--arch=arm64|x64] [--dir]   (--dir skips the .dmg and only makes the .app)
import { Arch, Platform, build as packager } from 'electron-builder'
import { build as bundle } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))

export const PRODUCT_NAME = 'Listen Instant Ans'
export const APP_ID = 'io.github.vist233.listen-instant-ans'

/** Without a developer certificate the app is signed "ad hoc": enough to run, not enough for the App Store. */
function signAdHoc(context) {
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}

export async function buildDesktop({ outDir = join(root, 'dist', 'desktop'), arch = 'arm64', dirOnly = false } = {}) {
  const stage = join(root, 'dist', 'desktop-stage')
  rmSync(stage, { recursive: true, force: true })
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })

  await bundle({
    entryPoints: [join(root, 'apps/desktop/src/main.ts')],
    outfile: join(stage, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
    legalComments: 'none',
    logLevel: 'warning',
  })
  cpSync(join(root, 'apps/web'), join(stage, 'public'), {
    recursive: true,
    filter: (source) => !/node_modules|\/test(\/|$)|tsconfig|package\.json/.test(source),
  })
  const version = read('package.json').version ?? '0.1.0'
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify({
    name: 'listen-instant-ans',
    productName: PRODUCT_NAME,
    version,
    description: '听老师讲课，几秒内给出问题的要点答案。',
    author: 'Vist233',
    main: 'main.cjs',
  }, null, 2)}\n`)

  const icon = join(root, 'apps/desktop/assets/icon.icns')
  const targetArch = arch === 'x64' ? Arch.x64 : Arch.arm64
  await packager({
    projectDir: stage,
    targets: Platform.MAC.createTarget(dirOnly ? 'dir' : 'dmg', targetArch),
    publish: 'never',
    config: {
      appId: APP_ID,
      productName: PRODUCT_NAME,
      artifactName: '${productName}-${version}-${arch}.${ext}',
      electronVersion: read('node_modules/electron/package.json').version,
      directories: { output: outDir },
      files: ['main.cjs', 'public/**', 'package.json'],
      asar: true,
      npmRebuild: false,
      afterPack: signAdHoc,
      mac: {
        category: 'public.app-category.education',
        identity: null,
        hardenedRuntime: false,
        gatekeeperAssess: false,
        ...(existsSync(icon) ? { icon } : {}),
        extendInfo: {
          NSMicrophoneUsageDescription: '需要使用麦克风来听写老师的讲课，并在老师提问后给出答案。',
        },
      },
      dmg: {
        title: '${productName} ${version}',
        window: { width: 540, height: 380 },
        contents: [
          { x: 140, y: 190, type: 'file' },
          { x: 400, y: 190, type: 'link', path: '/Applications' },
        ],
      },
    },
  })
  return { outDir, version, arch }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arch = (process.argv.find((item) => item.startsWith('--arch=')) ?? '--arch=arm64').slice(7)
  const result = await buildDesktop({ arch, dirOnly: process.argv.includes('--dir') })
  console.log(`Built ${PRODUCT_NAME} ${result.version} (${result.arch}) in ${result.outDir}`)
}

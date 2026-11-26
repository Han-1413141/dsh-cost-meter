// Rebuild the selected MIT-licensed protocol code from a pinned upstream checkout.
// Usage: node scripts/vendor-commandcode.mjs PATH_TO_DSH_COMMANDCODE_PROVIDER
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const upstream = resolve(process.argv[2])
const revision = 'b6f7578492bf8b4e20e3575ab9b71cc90c4dff69'
if (execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== revision
  || execFileSync('git', ['-C', upstream, 'diff', 'HEAD', '--', 'src'], { encoding: 'utf8' })) throw Error('Expected clean upstream 0.19.0 sources at ' + revision)
const dest = fileURLToPath(new URL('../lib/commandcode-vendor/', import.meta.url))
await mkdir(dest, { recursive: true })
for (const name of ['LICENSE', 'NOTICE']) await copyFile(join(upstream, name), join(dest, name))
const entries = {
  protocol: `export {CommandCodeAdapter} from './src/adapter.ts'
export {CommandCodeAccountPool,accountUsable} from './src/accounts.ts'
export {assertUsableApiKey} from './src/api-key.ts'
export {KNOWN_EFFORTS,KNOWN_IMAGE_MODELS,KNOWN_PLANS,PLAN_ORDER,dealLabel,peakPricingLabel} from './src/capabilities.ts'`,
  search: "export {CommandCodeSearchProvider} from './src/web-search.ts'",
}
for (const [name, contents] of Object.entries(entries)) {
  const { outputFiles } = await build({
    stdin: { contents, resolveDir: upstream }, absWorkingDir: upstream, platform: 'node', target: 'node20',
    format: 'esm', charset: 'utf8', bundle: true, write: false, treeShaking: true, legalComments: 'none',
    plugins: [{ name: 'cost-meter-host', setup(plugin) {
      plugin.onResolve({ filter: /^@deepseek-ai\// }, ({ path }) => ({ path: '../commandcode-host-' + path.split('/')[1].replace('dsh-', '') + '.js', external: true }))
      plugin.onLoad({ filter: /[/\\]stream-trace\.ts$/ }, () => ({
        contents: 'export const STREAM_TRACE_ENV = "DSH_COMMANDCODE_TRACE"; export const boundTraceText = () => ""; export const openStreamTrace = () => ({enabled:false,record(){},close(){}})',
      }))
      // Bind published model capabilities to the same catalogue row used for routing.
      plugin.onLoad({ filter: /[/\\]adapter\.ts$/ }, async ({ path }) => {
        let source = await readFile(path, 'utf8')
        for (const [before, after] of [
          ['const vision = KNOWN_IMAGE_MODELS.has(model.id)', 'const vision = model.image ?? KNOWN_IMAGE_MODELS.has(model.id)'],
          ['const imageCapable = KNOWN_IMAGE_MODELS.has(model)', 'const imageCapable = this.gatewayFacts.knownModel(this.deps.options(), model)?.image ?? KNOWN_IMAGE_MODELS.has(model)'],
          ['const vision = KNOWN_IMAGE_MODELS.has(model)', 'const vision = entry?.image ?? KNOWN_IMAGE_MODELS.has(model)'],
          ['const efforts = KNOWN_EFFORTS[model]', 'const efforts = entry?.reasoningEfforts ?? KNOWN_EFFORTS[model]'],
          ['if (!KNOWN_IMAGE_MODELS.has(options.model))', 'if (!(modelEntry?.image ?? KNOWN_IMAGE_MODELS.has(options.model)))'],
          ['const supported = KNOWN_EFFORTS[options.model]', 'const supported = modelEntry?.reasoningEfforts ?? KNOWN_EFFORTS[options.model]'],
          ["if (forced === 'cli') return forced", "if (forced === 'cli') return forced; if (forced === 'messages' && !this.routesToMessages(model, entry)) throw new LlmError('Model does not support Messages protocol', 'UNSUPPORTED_CONTENT')"],
        ]) {
          if (!source.includes(before)) throw Error('Upstream adapter changed: ' + before)
          source = source.replace(before, after)
        }
        return { loader: 'ts', contents: source }
      })
      plugin.onLoad({ filter: /[/\\]gateway-facts\.ts$/ }, async ({path}) => ({
        loader: 'ts', contents: (await readFile(path, 'utf8')).replaceAll('\r\n', '\n').replace('id, name, contextWindow,', 'id, name, contextWindow, image: typeof raw.image === "boolean" ? raw.image : undefined, reasoningEfforts: Array.isArray(raw.reasoningEfforts) ? raw.reasoningEfforts.filter(e => typeof e === "string").slice(0, 12) : undefined, minimumPlan: stringValue(raw.minimumPlan), deal: stringValue(raw.deal),').replace('signal?: AbortSignal): Promise<CommandCodeModel[]> {\n    signal?.throwIfAborted()', 'signal?: AbortSignal, force = false): Promise<CommandCodeModel[]> {\n    signal?.throwIfAborted()').replace('if (Date.now() < state.expiresAt)', 'if (!force && Date.now() < state.expiresAt)'),
      }))
    } }],
  })
  await writeFile(join(dest, name + '.js'), '// Generated from Mars-Sea/dsh-commandcode-provider 0.19.0. See LICENSE and NOTICE.\n' + outputFiles[0].text)
}

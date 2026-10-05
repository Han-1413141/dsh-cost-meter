/**
 * 共享 CLI 子进程桥(qwen-cli / bailian-cli):PATH 解析 + 固定参数执行 + JSON 读取。
 * 凭据始终由 CLI 自持;错误只携带分类标签(kind/exitCode),永不携带子进程输出或路径。
 */
import { execFile } from 'node:child_process'
import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path'

/** Resolve an npm-installed CLI without a shell; Windows npm .cmd shims are never evaluated. */
export async function resolveNpmCli({ packageName, binName, env = process.env, platform = process.platform } = {}) {
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
  for (const raw of pathValue.split(platform === 'win32' ? ';' : delimiter)) {
    const dir = raw.replace(/^"(.*)"$/, '$1')
    // Empty/relative PATH entries must not execute a workspace-supplied program.
    if (!isAbsolute(dir)) continue
    if (platform === 'win32') {
      // npm global installs put the package next to the Windows shim.
      const root = join(dir, 'node_modules', packageName)
      try {
        const meta = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
        const bin = meta.bin?.[binName]
        if (meta.name === packageName && typeof bin === 'string') {
          const target = resolve(root, bin), rel = relative(root, target)
          if (rel && !rel.startsWith('..') && !isAbsolute(rel) && (await stat(target)).isFile()) {
            return { file: process.execPath, args: [target] }
          }
        }
      } catch { /* Try the next installed executable. */ }
    }
    const file = join(dir, binName + (platform === 'win32' ? '.exe' : ''))
    try {
      await access(file, platform === 'win32' ? constants.F_OK : constants.X_OK)
      if ((await stat(file)).isFile()) return { file, args: [] }
    } catch { /* Not installed in this PATH entry. */ }
  }
  return null
}

/**
 * Run a fixed CLI command and consume stdout. Rejects only { kind, exitCode }:
 * 'maxbuffer' | 'timeout' | 'exit' | 'spawn' | 'json' — never raw output or paths.
 */
function runCli({ file, args, env = process.env, signal, timeoutMs = 15000, maxBuffer = 1024 * 1024 }, readOutput) {
  return new Promise((done, reject) => {
    const child = execFile(file, args, {
      encoding: 'utf8', windowsHide: true, shell: false, env, signal, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer,
    }, (error, out) => {
      if (error) {
        const kind = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'maxbuffer'
          : error.killed || error.code === 'ERR_CHILD_PROCESS_TIMEDOUT' ? 'timeout'
          : typeof error.code === 'number' ? 'exit'
          : 'spawn'
        reject(Object.assign(new Error('cli'), { kind, exitCode: typeof error.code === 'number' ? error.code : undefined }))
        return
      }
      try { done(readOutput(out)) } catch { reject(Object.assign(new Error('cli'), { kind: 'json' })) }
    })
    child.stdin?.end()
  })
}

export const runCliJson = options => runCli(options, JSON.parse)
/** Login output can contain private paths or credentials; discard it completely. */
export const runCliCommand = options => runCli(options, () => undefined)

/** Map a bridge error kind to a per-CLI message code (exitCode may refine 'exit'). */
export const bridgeCode = (error, { authExitCode } = {}) =>
  error.kind === 'timeout' ? 'timeout'
  : error.kind === 'maxbuffer' || error.kind === 'json' ? 'invalid'
  : error.kind === 'exit' && authExitCode !== undefined && error.exitCode === authExitCode ? 'auth'
  : 'failed'

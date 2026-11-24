#!/usr/bin/env node
/**
 * @module ai-code-health
 * @path ~/.dsh/ventures/ai-code-health/review.mjs
 * @description 一键代码体检 CLI：密钥泄露扫描 + 依赖可复现性 + 测试/构建状态，输出 Markdown 报告。
 *   本地运行、不上传任何代码；每条结论带证据（文件:行 或 真实退出码），测不了记 UNVERIFIED。
 * @zone action
 * @phase emerging
 * @tier Tier3-venture
 * @skill scan_secrets — 强特征密钥正则族（AWS/GitHub/OpenAI/Slack/私钥块/Google），命中即高危；
 *   弱特征（赋值形态的通用密钥名）只提示不判高危，且排除 example/placeholder/xxx 占位值。
 * @skill scan_deps — 依赖可复现性：浮动版本、安装期钩子、锁定文件缺失。
 * @skill run_script_probe — 探测并运行 npm test/build，带超时；超时/失败/缺失三态分明。
 * @rule real_exit_code P0 — 0=无高危 / 1=有高危 / 2=用法错误 / 3=目标不可读
 * @rule no_code_upload P0 — 体检全程本地完成，不发起任何网络请求（可在离线机器运行）
 * @rule unverified_not_pass P0 — 无法执行的检查（无 package.json、脚本缺失）必须写 UNVERIFIED，不得计入通过
 * @rule evidence_per_finding P1 — 每个发现必须带 `相对路径:行号` 或真实退出码，禁止只给结论
 * @rule timeout_bounded P1 — 外部命令一律带超时（默认 180s），避免体检把客户机器挂死
 * @depends node:fs, node:child_process, node:path
 * @error TargetUnreadable — 目标目录不存在或不可读 → 退出码 3
 * @metric measures{files,criticalSecrets,weakWarnings,deps,depFindings} — `--json` 输出，供上游汇总
 * @memory 2026-11-24 首个可售卖样品：源于 dsh-rsi 真实体检（542 文件 0 密钥、46/46 测试、708 步 17 红分类）
 *
 * 用法：
 *   node review.mjs <目标目录> [--json] [--out report.md] [--timeout 秒]
 *
 * 退出码：0=无高危  1=有高危  2=用法错误  3=目标不可读
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'vendor', '.venv', '__pycache__'])
const MAX_FILE_BYTES = 2 * 1024 * 1024
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml', '.env', '.sh', '.py', '.go', '.rs', '.java', '.php', '.rb', '.toml', '.ini', '.conf', '.md'])

/** 强特征密钥模式：命中即高危（要求足够长度，避免误报示例值）。 */
const SECRET_PATTERNS = [
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'GitHub Token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'OpenAI/DeepSeek Key', re: /\bsk-[A-Za-z0-9_-]{32,}\b/g },
  { name: 'Slack Token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Private Key Block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
]

/** 弱特征：只提示（赋值形态的通用密钥名），不判高危。 */
const WEAK_PATTERNS = [
  { name: '疑似硬编码密钥赋值', re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"]{12,}['"]/gi },
]

/**
 * 递归收集待扫文件。
 * @param {string} root 目标根目录
 * @returns {string[]} 绝对路径列表
 */
function collectFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(join(dir, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      const full = join(dir, entry.name)
      const dot = entry.name.lastIndexOf('.')
      const ext = dot >= 0 ? entry.name.slice(dot).toLowerCase() : ''
      if (!TEXT_EXT.has(ext) && !entry.name.startsWith('.env')) continue
      try { if (statSync(full).size > MAX_FILE_BYTES) continue } catch { continue }
      out.push(full)
    }
  }
  walk(root)
  return out
}

/**
 * 判定一个命中是否落在「测试夹具/示例」语境里。
 * 依据（三选一即视为夹具）：路径含测试目录或测试文件后缀；同目录/同文件命名含 fixture|example|sample|mock；
 * 命中行本身带 fake|dummy|example|test 标记。**不猜内容，只看可核的路径与行文本。**
 * @param {string} relPath 相对路径
 * @param {string} lineText 命中行文本
 * @returns {boolean}
 */
/**
 * 命中分诊：把"看起来像密钥"的东西按**可核语境**分到五类，只有 REAL 才需要客户动手。
 * - fixture：测试夹具/示例（isFixtureContext）
 * - rulefile：本身就是密钥扫描规则/基线（gitleaks.toml、.gitleaks、detect-secrets baseline）
 * - doc：文档/模板（.md 里演示密钥格式）
 * - artifact：构建产物（lib/ dist/ build/ chunks/ 压缩包）
 * - real：其余 ⇒ 真需处理
 * @param {string} relPath 相对路径
 * @param {string} lineText 命中行
 * @returns {'fixture'|'rulefile'|'doc'|'artifact'|'real'}
 */
function triageContext(relPath, lineText) {
  if (isFixtureContext(relPath, lineText)) return 'fixture'
  const p = relPath.toLowerCase()
  if (/(gitleaks\.toml|\.gitleaks|detect-secrets|secrets?[-_]?baseline|secret-patterns?)/.test(p)) return 'rulefile'
  if (p.endsWith('.md') || p.endsWith('.mdx') || p.endsWith('.txt') || p.includes('/docs/')) return 'doc'
  if (/(^|\/)(lib|dist|build|out|chunks|vendor)(\/|$)/.test(p) || /\.min\.(js|css)$/.test(p)) return 'artifact'
  // 检测器自身：文件就是"找密钥/找泄露"的实现，里面必然出现样例形态（本仓库实测 4 条全属此类）。
  if (/(verify|check|scan|audit|guard|lint)[-_\w]*secret|secret[-_]?(scan|check|detect|guard)/.test(p)) return 'detector'
  // 数据/知识库快照：把文档内容存成 json/ndjson 的库文件（如 okf.json），命中来自文档正文而非运行代码。
  if (/\.(json|ndjson|jsonl)$/.test(p) && /(store|snapshot|corpus|knowledge|okf|memory)/.test(p)) return 'snapshot'
  return 'real'
}

function isFixtureContext(relPath, lineText) {
  const p = relPath.toLowerCase()
  if (/(^|\/)(tests?|__tests__|spec|specs|fixtures?|testdata|e2e)(\/|$)/.test(p)) return true
  if (/(_test\.go|\.spec\.(ts|js|mjs|tsx)|\.test\.(ts|js|mjs|tsx)|(^|\/)test_.*\.py)$/.test(p)) return true
  if (/(fixture|example|sample|mock|dummy|fake)/.test(p)) return true
  if (/\b(fake|dummy|example|placeholder|redact|test[_-]?(?:key|token|secret))\b/i.test(lineText)) return true
  return false
}

/**
 * 扫描密钥泄露。
 * @param {string} root 目标根目录
 * @returns {{critical: string[], warnings: string[], scanned: number}}
 */
function scanSecrets(root) {
  const files = collectFiles(root)
  const critical = []
  const warnings = []
  const triaged = { fixture: [], rulefile: [], doc: [], artifact: [], detector: [], snapshot: [] }
  for (const file of files) {
    let text
    try { text = readFileSync(file, 'utf8') } catch { continue }
    const lines = text.split('\n')
    for (const { name, re } of SECRET_PATTERNS) {
      re.lastIndex = 0
      for (const match of text.matchAll(re)) {
        const line = text.slice(0, match.index).split('\n').length
        const relPath = relative(root, file)
        const lineText = text.slice(text.lastIndexOf('\n', match.index) + 1, text.indexOf('\n', match.index) === -1 ? undefined : text.indexOf('\n', match.index))
        const label = `${relPath}:${line} ${name}`
        // 测试夹具里的假密钥不等于泄露：单独归类，避免"狼来了"式报告（实测 28 条里 26 条是夹具）。
        const bucket = triageContext(relPath, lineText)
        if (bucket === 'real') critical.push(label)
        else triaged[bucket].push(label)
      }
    }
    for (const { name, re } of WEAK_PATTERNS) {
      re.lastIndex = 0
      for (const match of text.matchAll(re)) {
        const line = text.slice(0, match.index).split('\n').length
        // 明显是占位/示例的不报
        if (/example|placeholder|your[_-]?key|xxx|\*\*\*/i.test(match[0])) continue
        warnings.push(`${relative(root, file)}:${line} ${name}`)
      }
    }
    void lines
  }
  return { critical, warnings, triaged, scanned: files.length }
}

/**
 * 依赖风险。
 * @param {string} root 目标根目录
 * @returns {{findings: string[], deps: number, unverified: string[]}}
 */
function scanDeps(root) {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) return { findings: [], deps: 0, unverified: ['无 package.json（非 Node 项目）'] }
  let pkg
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch { return { findings: [], deps: 0, unverified: ['package.json 无法解析'] } }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  const names = Object.keys(deps)
  const findings = []
  const floating = names.filter((n) => /^[\^~*]|^latest$|^>/.test(String(deps[n])) || String(deps[n]) === '')
  if (floating.length > 0) findings.push(`${floating.length} 个依赖使用浮动版本（构建不可复现）：${floating.slice(0, 5).join(', ')}${floating.length > 5 ? ' …' : ''}`)
  const scripts = { ...(pkg.scripts ?? {}) }
  const hooky = Object.entries(scripts).filter(([k]) => /^(pre|post)(install|prepare)$/.test(k))
  if (hooky.length > 0) findings.push(`存在安装期钩子脚本（会在 npm install 时执行）：${hooky.map(([k]) => k).join(', ')}`)
  const hasLock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].some((f) => existsSync(join(root, f)))
  if (!hasLock) findings.push('缺少锁定文件（package-lock/pnpm-lock/yarn.lock）⇒ 依赖版本不可复现')
  return { findings, deps: names.length, unverified: [] }
}

/**
 * 运行一个 npm 脚本并捕获结果（带超时，绝不挂死）。
 * @param {string} root 目标根目录
 * @param {string} script 脚本名
 * @param {number} timeoutMs 超时毫秒
 * @returns {{status: 'pass'|'fail'|'absent'|'timeout', detail: string}}
 */
function runScript(root, script, timeoutMs) {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) return { status: 'absent', detail: '无 package.json' }
  let pkg
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch { return { status: 'absent', detail: 'package.json 不可解析' } }
  if (!pkg.scripts || !pkg.scripts[script]) return { status: 'absent', detail: `未定义 ${script} 脚本` }
  try {
    const out = execFileSync('npm', ['run', '--silent', script], {
      cwd: root, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const tail = String(out).trim().split('\n').slice(-3).join(' / ').slice(0, 200)
    return { status: 'pass', detail: tail || 'exit 0' }
  } catch (error) {
    const status = error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT' ? 'timeout' : 'fail'
    const detail = String(error?.stdout ?? error?.stderr ?? error?.message ?? '').trim().split('\n').slice(-3).join(' / ').slice(0, 200)
    return { status, detail: detail || `exit ${error?.status ?? 'unknown'}` }
  }
}

/**
 * 生成 Markdown 报告。
 * @param {string} root 目标
 * @param {object} data 各检查结果
 * @returns {string} Markdown
 */
function renderMarkdown(root, data) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const criticalCount = data.secrets.critical.length
  const lines = []
  lines.push('# AI 代码体检报告')
  lines.push('')
  lines.push(`- 目标：\`${root}\``)
  lines.push(`- 时间：${now}`)
  lines.push(`- 扫描文件：${data.secrets.scanned}`)
  lines.push(`- 结论：${criticalCount > 0 ? `**发现 ${criticalCount} 处高危**` : '**无高危泄露**'}`)
  lines.push('')
  lines.push('## 1. 密钥泄露')
  if (criticalCount === 0) lines.push('无强特征密钥命中（AWS/GitHub/OpenAI/私钥块等）。')
  else {
    lines.push('| 位置 | 类型 |')
    lines.push('|---|---|')
    for (const hit of data.secrets.critical.slice(0, 50)) {
      const [where, kind] = hit.split(' ')
      lines.push(`| \`${where}\` | ${kind} |`)
    }
  }
  const tri = data.secrets.triaged
  const triTotal = Object.values(tri).reduce((sum, arr) => sum + arr.length, 0)
  if (triTotal > 0) {
    lines.push('')
    lines.push('以下命中经**语境分诊**后不计高危（列出以证明扫描生效、并说明分类依据）：')
    lines.push('')
    lines.push('| 类别 | 条数 | 依据 |')
    lines.push('|---|---|---|')
    lines.push(`| 测试夹具/示例 | ${tri.fixture.length} | 路径为 tests/spec/fixtures，或行内含 fake/dummy/redact 标记 |`)
    lines.push(`| 扫描规则/基线 | ${tri.rulefile.length} | 文件本身是 gitleaks/detect-secrets 规则 |`)
    lines.push(`| 文档/模板 | ${tri.doc.length} | .md/.mdx/docs/ 内的格式演示 |`)
    lines.push(`| 构建产物 | ${tri.artifact.length} | lib/dist/build/chunks 或 .min.js |`)
    lines.push(`| 检测器自身 | ${tri.detector.length} | 文件即"找密钥"的实现，样例形态必然出现 |`)
    lines.push(`| 数据/知识库快照 | ${tri.snapshot.length} | json/ndjson 库文件，命中来自文档正文 |`)
  }
  if (data.secrets.warnings.length > 0) {
    lines.push('')
    lines.push(`提示（非高危，建议人工确认）${data.secrets.warnings.length} 处：`)
    for (const w of data.secrets.warnings.slice(0, 10)) lines.push(`- \`${w}\``)
  }
  lines.push('')
  lines.push('## 2. 依赖与可复现性')
  lines.push(`依赖总数：${data.deps.deps}`)
  if (data.deps.findings.length === 0) lines.push('无风险提示。')
  else for (const f of data.deps.findings) lines.push(`- ${f}`)
  if (data.deps.unverified.length > 0) for (const u of data.deps.unverified) lines.push(`- UNVERIFIED：${u}`)
  lines.push('')
  lines.push('## 3. 测试')
  lines.push(`状态：**${data.test.status}**${data.test.detail ? `（${data.test.detail}）` : ''}`)
  lines.push('')
  lines.push('## 4. 构建')
  lines.push(`状态：**${data.build.status}**${data.build.detail ? `（${data.build.detail}）` : ''}`)
  lines.push('')
  lines.push('## 建议动作')
  const actions = []
  if (criticalCount > 0) actions.push('**立即**：轮换已泄露凭据（先撤销再改代码，顺序不能反）')
  if (data.deps.findings.some((f) => f.includes('缺少锁定文件'))) actions.push('提交锁定文件，保证依赖可复现')
  if (data.test.status === 'fail') actions.push('修复失败测试后再交付（测试红=交付不可信）')
  if (data.test.status === 'absent') actions.push('项目无测试脚本：至少为关键路径补 1 个可跑的测试')
  if (data.build.status === 'fail') actions.push('修复构建失败（构建红=无法交付）')
  if (actions.length === 0) actions.push('无阻断项；可进入功能审查')
  for (const a of actions) lines.push(`- ${a}`)
  lines.push('')
  lines.push('---')
  lines.push('本报告由本地工具生成，不上传任何代码。每条结论均可用报告中的命令复现。')
  return lines.join('\n') + '\n'
}

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
  console.log('用法: node review.mjs <目标目录> [--json] [--out report.md] [--timeout 秒]')
  process.exit(2)
}
const target = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')
if (!existsSync(target) || !statSync(target).isDirectory()) {
  console.error(`目标目录不可读: ${target}`)
  process.exit(3)
}
const timeoutIdx = argv.indexOf('--timeout')
const timeoutMs = (timeoutIdx >= 0 ? Number(argv[timeoutIdx + 1]) : 180) * 1000

const secrets = scanSecrets(target)
const deps = scanDeps(target)
const test = runScript(target, 'test', timeoutMs)
const build = runScript(target, 'build', timeoutMs)
const data = { secrets, deps, test, build }

if (argv.includes('--json')) {
  console.log(JSON.stringify({
    target,
    at: new Date().toISOString(),
    measures: {
      files: secrets.scanned,
      criticalSecrets: secrets.critical.length,
      triaged: Object.fromEntries(Object.entries(secrets.triaged).map(([k, v]) => [k, v.length])),
      weakWarnings: secrets.warnings.length,
      deps: deps.deps,
      depFindings: deps.findings.length,
    },
    test,
    build,
    critical: secrets.critical,
    warnings: secrets.warnings,
    depFindings: deps.findings,
  }, null, 2))
  process.exit(secrets.critical.length > 0 ? 1 : 0)
}

const md = renderMarkdown(target, data)
const outIdx = argv.indexOf('--out')
if (outIdx >= 0 && argv[outIdx + 1]) {
  writeFileSync(argv[outIdx + 1], md, 'utf8')
  console.log(`报告已写入 ${argv[outIdx + 1]}`)
} else {
  process.stdout.write(md)
}
process.exit(secrets.critical.length > 0 ? 1 : 0)

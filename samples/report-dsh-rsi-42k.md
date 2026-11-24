# AI 代码体检报告

- 目标：`/data/mysources/dsh-rsi`
- 时间：2026-11-24 06:54:18
- 扫描文件：42986
- 结论：**无高危泄露**

## 1. 密钥泄露
无强特征密钥命中（AWS/GitHub/OpenAI/私钥块等）。

以下命中经**语境分诊**后不计高危（列出以证明扫描生效、并说明分类依据）：

| 类别 | 条数 | 依据 |
|---|---|---|
| 测试夹具/示例 | 18 | 路径为 tests/spec/fixtures，或行内含 fake/dummy/redact 标记 |
| 扫描规则/基线 | 1 | 文件本身是 gitleaks/detect-secrets 规则 |
| 文档/模板 | 2 | .md/.mdx/docs/ 内的格式演示 |
| 构建产物 | 1 | lib/dist/build/chunks 或 .min.js |
| 检测器自身 | 3 | 文件即"找密钥"的实现，样例形态必然出现 |
| 数据/知识库快照 | 3 | json/ndjson 库文件，命中来自文档正文 |

提示（非高危，建议人工确认）260 处：
- `.agents/skills/claude-api/php/managed-agents/README.md:22 疑似硬编码密钥赋值`
- `.agents/skills/claude-api/python/claude-api/README.md:20 疑似硬编码密钥赋值`
- `.agents/skills/claude-api/python/managed-agents/README.md:24 疑似硬编码密钥赋值`
- `.agents/skills/claude-api/ruby/claude-api/README.md:20 疑似硬编码密钥赋值`
- `.agents/skills/claude-api/ruby/managed-agents/README.md:22 疑似硬编码密钥赋值`
- `.agents/skills/claude-api/typescript/claude-api/README.md:26 疑似硬编码密钥赋值`
- `.agents/skills/claude-api/typescript/managed-agents/README.md:24 疑似硬编码密钥赋值`
- `.agents/skills/code-review-skill/reference/java.md:180 疑似硬编码密钥赋值`
- `.agents/skills/code-review-skill/reference/security-review-guide.md:351 疑似硬编码密钥赋值`
- `.agents/skills/redis-development/AGENTS.md:1973 疑似硬编码密钥赋值`

## 2. 依赖与可复现性
依赖总数：83
- 37 个依赖使用浮动版本（构建不可复现）：@stylistic/eslint-plugin, @testing-library/dom, @testing-library/react, @types/js-yaml, @types/jsdom …
- 存在安装期钩子脚本（会在 npm install 时执行）：postinstall

## 3. 测试
状态：**fail**（ ✓ |thread-safe| packages/experimental/client-ui-forge/tests/format.client.spec.ts (20 tests) 3ms /  ✓ |thread-safe| packages/client/ui-conversation/tests/image-labels.client.spec.ts (3 tests) 2ms /  ）

## 4. 构建
状态：**pass**（ / run-gates: 10 passed, 0 failed, 0 skipped in 18.44s. / build: recorded 391 client artifact(s) with 3 public value(s)）

## 建议动作
- 修复失败测试后再交付（测试红=交付不可信）

---
本报告由本地工具生成，不上传任何代码。每条结论均可用报告中的命令复现。

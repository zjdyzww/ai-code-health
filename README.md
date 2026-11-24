# ai-code-health · 一键代码体检

> 三分钟出报告：**你的仓库里有没有真泄露、依赖能不能复现、测试和构建是不是红的。**
> 全程本地运行，不上传一行代码。

## 它解决什么问题

大多数"安全扫描"报告的问题是：**喊狼来了**。
一个 4 万文件的仓库，粗暴扫描会报出 28 处"密钥泄露"——其中 18 处是测试夹具里的假密钥、
3 处是扫描器自己的规则、2 处是文档模板、1 处是构建产物、3 处是文档快照。**真泄露 0 处。**

`ai-code-health` 的价值就在这句 **"0 处"** —— 它把每个候选命中**分诊**到 6 个类别并给出依据，
让你不用花 3 小时逐条确认"这是不是真的"。

## 怎么用

```bash
node review.mjs /path/to/your/repo                 # 打印 Markdown 报告
node review.mjs /path/to/your/repo --out r.md      # 写入文件
node review.mjs /path/to/your/repo --json          # 机器可读（供 CI 用）
node review.mjs /path/to/your/repo --timeout 300    # 测试/构建超时（默认 180s）
```

退出码：`0` 无高危 · `1` 有高危 · `2` 用法错误 · `3` 目标不可读 —— 可直接挂进 CI。

## 四项检查

| 检查 | 内容 | 输出 |
|---|---|---|
| 密钥泄露 | 6 类强特征正则（AWS/GitHub/OpenAI/Slack/私钥块/Google） + 弱特征提示 | 真高危列表 + 6 类分诊表 |
| 依赖可复现性 | 浮动版本、安装期钩子、锁定文件缺失 | 风险条目 |
| 测试 | 自动探测 `npm test`，带超时 | pass / fail / absent / timeout |
| 构建 | 自动探测 `npm run build`，带超时 | pass / fail / absent / timeout |

**测不了的一律写 `UNVERIFIED`**，绝不当成"通过"。

## 分诊规则（可审计，不是黑盒）

| 类别 | 判定依据 |
|---|---|
| 测试夹具/示例 | 路径含 `tests/`、`__tests__`、`fixtures/`、`*.spec.*`、`*_test.go`；或命中行含 `fake/dummy/example/redact` |
| 扫描规则/基线 | 文件名含 `gitleaks.toml`、`.gitleaks`、`detect-secrets`、`secrets-baseline` |
| 文档/模板 | `.md/.mdx/.txt` 或路径含 `/docs/` |
| 构建产物 | 路径含 `lib/ dist/ build/ chunks/ vendor/` 或 `*.min.js` |
| 检测器自身 | 文件名含 `verify-*secret*`、`*secret-scan*` 等 |
| 数据/知识库快照 | `.json/.ndjson` 且路径含 `store/snapshot/corpus/knowledge` |

## 真实样例（本机实测，4.3 万文件仓库）

```
扫描文件：42986
候选命中：28
真高危：  0
分诊：测试夹具 18 · 规则文件 1 · 文档 2 · 构建产物 1 · 检测器 3 · 知识库快照 3
依赖问题：2（浮动版本 1、缺锁定文件 1）
用时：约 3 分钟
```

## 收费（三种）

| 档 | 交付 | 价格 |
|---|---|---|
| 体检报告 | 本工具报告 + 我人工复核 6 类分诊 + 一页行动清单 | ¥199 |
| 体检 + 修复 | 上述 + 修掉"可修项"（依赖锁定、构建/测试红、真泄露轮换指引） | ¥899 起 |
| 月度监控 | 每周自动跑 + 报告 + 变动告警 | ¥399/月 |

## 边界（先说不做的）

- 不做渗透测试、不做合规认证（等保/SOC2 需持牌机构）
- 不覆盖非 Node 生态的测试/构建探测（会写 `absent`，不猜）
- 报告只覆盖"本机能跑到的部分"；外部依赖缺失记 `UNVERIFIED`

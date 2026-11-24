# 为什么"更严的正则"救不了你的密钥扫描

> 一份基于实测数据的技术说明。所有数字都附来源与复现方式，结论里也写清它**不能**证明什么。

---

## 一、先把问题量化

2026 年 11 月，我用同一套规则在两个样本集上跑分诊：

| 样本 | 文件数 | 疑似密钥候选 | 其中真泄露 |
|---|---|---|---|
| 9 个**安全工具**仓库（gitleaks 类工具的同行） | 240 | 33 | **0** |
| 10 个**主流库**（express / axios / lodash / fastify / got / moment …） | 2,242 | **2** | **0** |

复现：`gh api repos/zjdyzww/secret-fp-census` 里有完整名单与命令。

两组数据合起来说明一件事，而且是我一开始不愿承认的：

> **在通用仓库里，我的强特征规则几乎什么都扫不出来（2,242 文件 → 2 候选）。**
> 而那 33 条候选之所以出现，是因为**安全工具仓库里必然存在"密钥长什么样"的规则文本**。

所以"误报"的本质不是正则写得不严，而是——

**同一串字符，在不同语境里的风险等级完全不同。**

---

## 二、三个真实世界的例子

从 GitHub 公开 issue 里取的（每条都可查）：

| 现象 | 为什么扫描器会报 | 为什么它不是泄露 |
|---|---|---|
| 文档里写 `STRIPE_SECRET_KEY`（只有变量名） | 匹配到"像密钥的键名" | 没有值，只有名字 |
| 配置里写 `AKIAIOSFODNN7EXAMPLE` | 形态合法（AWS 官方文档用的就是这串） | 它是**公开的示例值**，不是凭据 |
| 加载了 base64 内嵌小图片 `iVBORw0KGgo...` | 熵值高、长度够 | 它是图片，不是密钥 |

三条都不是"正则写错了"。**它们的共同点是：判定需要文件之外的上下文。**

---

## 三、为什么不靠"更严的正则"

把正则改严有明确的代价：

- 规则再严一点 → 误报少一点，**漏报多一点**；
- 漏报的代价是不对称的：一次漏掉的真实凭据 = 一次事故；一次误报 = 一次点击。

所以正确的方向不是"调阈值"，而是**在阈值之外再加一层语境判定**：

```
扫描器（负责"发现"） → 分诊（负责"判定"）
```

我做的只有后半段。判定依据是六类语境：

| 桶 | 判据 | 例 |
|---|---|---|
| 测试夹具 | 路径属 tests/fixtures/spec，或行内是构造值 | `tests/redact.spec.ts:44` |
| 扫描规则文件 | 路径含 rules/signatures/patterns，或文件名像 `*.regexes.json` | `rules/aws.yml:16` |
| 文档 / 模板 | `.md` / `.txt` / `docs/` | `docs/example-env.md:5` |
| 构建产物 | `lib/` `dist/` `build/` `*.min.js` | `dist/app.min.js:1` |
| 检测器自身 | 文件名像 `verify-*secret*`、`secret-scan` | `verify-secret-rules.mjs:3` |
| 知识库快照 | 含 store/snapshot/corpus 的 json | `okf/store.json:120` |

**六类之外一律判"真"**——宁严不宽。误判成"要处理"只是多花 10 分钟；误判成"不用管"可能是事故。

---

## 四、这层判定的实测效果

在一个独立 demo 仓库里做了端到端验证（可复现）：

```
输入 3 条：rules/aws.yml（规则文件）· tests/redact.spec.ts（夹具）· src/leak.js（真密钥形态）
→ 分诊输出 SARIF：1 条结果
→ 上传 GitHub 代码扫描
→ 查 API：code-scanning/alerts 只有 1 条（src/leak.js）
```

两条噪声**一条都没进 Security 页**。
查证命令：`gh api repos/zjdyzww/secret-triage-demo/code-scanning/alerts`（该告警是合成样本，验证后已 dismiss）。

---

## 五、这套东西**做不到**什么（这一段比上面重要）

1. **不替代扫描器**：我的 6 类特征太窄（见第一节，2,242 文件出 2 条候选）。请带着你现有扫描器的输出来。
2. **不保证安全**："0 条真泄露"只意味着**在这 6 类特征范围内**没发现。
3. **不覆盖 git 历史**：我只判当前工作树；扫描器多半扫全历史——两者结论不该互相比。
4. **不是渗透测试 / 不是安全审计 / 不是合规证明**。
5. **判据可能错**：如果你发现某条判定不对，那是我的问题，我重写规则并补一条回归样本。

---

## 六、一条给团队的实用建议（免费）

**把 recall 钉死在 100%，precision 慢慢提。**

很多团队把两者放在一起调，结果悄悄把 recall 调低了——那是最危险的方向。
漏一个密钥是安全事故；多一条误报只是噪音。

如果你要用回归测试固化这件事：`github.com/zjdyzww/secret-precision-suite`
（5 个"不该报" + 4 个"必须报"样本 + precision/recall 断言 + 可接 CI 的退出码；
**"跑不起来"是 exit 3，不算失败**——不能把环境问题说成安全问题。）

---

## 七、复现清单

```bash
# 1. 普查数据
gh api repos/zjdyzww/secret-fp-census --jq '.description'

# 2. 端到端去噪证据
gh api repos/zjdyzww/secret-triage-demo/code-scanning/alerts --jq '.[] | .most_recent_instance.location.path'

# 3. 自己跑
git clone --depth 1 https://github.com/tillson/git-hound.git
node review.mjs git-hound --json   # 31 条候选，全部 rulefile，critical=0
```

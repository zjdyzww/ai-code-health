# 30 秒看懂：给定一份扫描器报告，我判成什么样

**不需要安装任何东西。** 下面这一对文件就是完整的"输入 → 输出"。

## 输入：`examples/toaster-ready.gitleaks.json`

某扫描器在一个真实公开仓库（52 文件）上给出的 **9 条**告警，gitleaks 格式：

```json
[
  { "File": "internal/check/secrets_test.go", "StartLine": 22, "RuleID": "generic-api-key" },
  { "File": "internal/check/secrets_test.go", "StartLine": 32, "RuleID": "generic-api-key" },
  ...
]
```

## 输出：`examples/toaster-ready.triage.txt`

```
输入候选 9 条 → 真需处理 0 条，其余 9 条经语境分诊排除

需要处理：无（0 条）

已排除 · 测试夹具（9）：
  - internal/check/secrets_test.go:22 [generic-api-key]
  ...
```

## 它做了什么判断

`internal/check/secrets_test.go` 是一个**测试文件**——里面写的是用来测"能不能识别密钥"的**假值**。
扫描器只看字符串形状，所以报警；分诊看**语境**（路径属测试 + 行内是构造值），所以排除。

## 你要核对的话，只需两步

```bash
# 1. 打开那个文件第 22 行，看是不是假值
sed -n '22p' internal/check/secrets_test.go

# 2. 换一份你自己的扫描器报告，跑同一条命令
node review.mjs <你的仓库> --from-report 你的报告.json
```

## 我做错的例子（就在这份材料里）

第一版我在这个仓库上报了 **6 条"真高危"**，全都因为没认出"测试文件"这个语境；
补规则后为 0。**这份 demo 的输入，就是我自己修完 bug 之后的真实产物。**

## 它不能证明什么

- 不能证明这 9 条一定不是密钥（我没看到你的 git 历史）
- 不能证明这个仓库安全
- 不能替代扫描器——**它只做扫描器后面的那一步**

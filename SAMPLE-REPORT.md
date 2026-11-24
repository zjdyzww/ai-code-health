# 你会拿到什么（真实样例，不是示意图）

来源：一个真实公开仓库 `tillson/git-hound`（一个密钥扫描工具本身）。
它的扫描器在**它自己的仓库**里报了 12 条"疑似密钥"。

## 输入长这样（你手上的扫描器报告，gitleaks 风格）

```json
[
  { "File": "rules/digitalocean.yml", "StartLine": 24, "RuleID": "generic-api-key" },
  { "File": "rules/aws.yml", "StartLine": 16, "RuleID": "aws-access-token" }
]
```
（完整文件：`examples/git-hound.scanner-report.json`）

## 输出长这样

```
=== 分诊已有扫描器输出 ===
输入候选 12 条 → 真需处理 0 条，其余 12 条经语境分诊排除

需要处理：无（0 条）

已排除 · 扫描规则文件（12）：
  - rules/digitalocean.yml:24 [generic-api-key]
  - rules/aws.yml:16 [aws-access-token]
  ...
```
（完整输出：`examples/git-hound.triage.txt`）

## 一句话结论

> **这 12 条全是它自己的规则文件里"密钥长什么样"的正则。** 没有一条需要轮换凭据。

## 如果我判错了，你能怎么核对

1. 打开 `rules/aws.yml` 第 16 行看一眼——那是正则，不是凭据；
2. 自己跑同一条命令，得到同样结果：
   ```bash
   node review.mjs <仓库> --from-report examples/git-hound.scanner-report.json
   ```
3. 如果你认为哪条判错了，告诉我，我改规则并**补一条回归样本**（这样同样的错不会再犯）。

## 这份样例**不**代表

- 你的仓库也是"0 条"——我不知道你的仓库里有什么；
- 我比 git-hound 强——它扫的是全 git 历史，我只判当前工作树；
- 我能保证任何事——这不是渗透测试，也不是安全审计。

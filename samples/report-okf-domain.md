# AI 代码体检报告

- 目标：`/data/mysources/dsh-rsi/packages/oscplugins/okf-domain`
- 时间：2026-11-24 06:57:55
- 扫描文件：24
- 结论：**无高危泄露**

## 1. 密钥泄露
无强特征密钥命中（AWS/GitHub/OpenAI/私钥块等）。

## 2. 依赖与可复现性
依赖总数：9
- 2 个依赖使用浮动版本（构建不可复现）：@types/node, typescript
- 缺少锁定文件（package-lock/pnpm-lock/yarn.lock）⇒ 依赖版本不可复现

## 3. 测试
状态：**absent**（未定义 test 脚本）

## 4. 构建
状态：**absent**（未定义 build 脚本）

## 建议动作
- 提交锁定文件，保证依赖可复现
- 项目无测试脚本：至少为关键路径补 1 个可跑的测试

---
本报告由本地工具生成，不上传任何代码。每条结论均可用报告中的命令复现。

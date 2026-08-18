# 安全策略 · Security Policy

## 报告漏洞 / Reporting a Vulnerability

**请勿通过公开 issue 报告安全漏洞。**

如果你发现 dsh-cost-meter 存在安全漏洞(如凭据泄露路径、请求伪造、账本数据越权读写等),请通过 **GitHub 私有漏洞报告** 提交:

1. 打开仓库的 **Security → Report a vulnerability**(https://github.com/Han-1413141/dsh-cost-meter/security/advisories/new);
2. 描述漏洞现象、影响范围与复现方式(可附最小 PoC);
3. 我们会在 **72 小时内确认收到**,并在 **7 天内**给出处理进展;修复发布后会在 Release notes 中致谢报告者(除非你要求匿名)。

若私有通道不可用,可联系仓库维护者 @Han-1413141(不要在公开渠道贴出漏洞细节)。

**Do NOT open a public issue for security vulnerabilities.** Use GitHub's private vulnerability reporting (Security → Report a vulnerability) at https://github.com/Han-1413141/dsh-cost-meter/security/advisories/new. We will acknowledge within 72 hours and provide a status update within 7 days. Reporters are credited in release notes unless anonymity is requested.

## 支持版本 / Supported Versions

| 版本 | 安全修复支持 |
|---|---|
| 最新 Release(见 [Releases](https://github.com/Han-1413141/dsh-cost-meter/releases)) | ✅ |
| 更早版本 | ❌ 请升级到最新版 |

Only the latest release receives security fixes — please upgrade.

## 安全相关设计 / Security-relevant design

供漏洞研究参考的既有边界:

- **API Key 只发往官方/用户自配端点**:官方余额查询强制 `api.deepseek.com`(非官方 baseURL 直接拒绝);Coding Plan 各家凭据只发往硬编码白名单内的官方端点(verify.mjs 有域名白名单断言);自定义余额端点为用户显式自配,`{{ENV_VAR}}` 凭据占位符只注入到该自配请求。
- **账本与配置仅存于本地** `$DSH_HOME/storages/cost-meter/`,无远端上报。

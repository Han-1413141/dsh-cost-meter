# v1.9.65

## 中文

- 输入区套餐进度条新增“显示套餐余额”开关，默认开启。关闭后保留进度条，余额可在悬浮提示中查看，预览和保存状态同步。
- 修复没有模型 API Key 时，模型设置读取失败阻断官方账号钱包查询的问题；手动刷新可重新读取失败的模型路由。
- 历史价格差分共用已清洗的不可变价表分支，减少重复遍历和序列化，保留全部价格版本与时间点。
- 自定义余额 `sum` 支持 `where` 精确过滤，可按 Magpie provider 汇总 WorkBuddy 积分。
- 核对 dsh-codex-subscription 3.2.16 发布包与既有接入函数，将兼容基线更新至 3.2.16。

输入区开关位置：**费用 → 显示 → 输入区 → 套餐进度条 → 显示套餐余额**。

历史价格优化使用 448 个不同价格版本的本地合成账本验证，同一进程依次测得 v1.9.64 解码 918 ms、此版 91 ms；堆内存增量分别为 77.0 MiB 和 41.3 MiB。逐一核对历史时间点的费率一致。这是合成数据测量，未使用报告者账本。版本数量仍随实际价格变化增长，不按天删除历史费率。

感谢 [@JhanSu](https://github.com/JhanSu) 在 [#498](https://github.com/Han-1413141/dsh-cost-meter/pull/498) 提供过滤功能、文档和测试，[@ferrisching](https://github.com/ferrisching) 在 [#500](https://github.com/Han-1413141/dsh-cost-meter/issues/500) 提供账号余额复现和分析，[@lshan99q](https://github.com/lshan99q) 在 [#501](https://github.com/Han-1413141/dsh-cost-meter/issues/501) 提供历史价格性能测量与优化建议。输入区金额开关来自用户提供的群聊反馈，未提供 GitHub 账号。

## English

- Add a **Show plan balance** toggle to composer plan bars, enabled by default. Hiding the amount preserves progress bars and hover details, with matching preview and saved preferences.
- Keep the signed-in account wallet available when no model API key exists and model settings cannot be read. Manual refresh retries unavailable model routes.
- Reuse sanitized immutable branches when loading historical price deltas, reducing repeated traversal and serialization while preserving every version and activation time.
- Support exact `where` filters in custom-balance sums, including Magpie WorkBuddy credits.
- Check the published dsh-codex-subscription 3.2.16 package and existing integration functions; update the compatibility baseline to 3.2.16.

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 `dsh web`。Desktop 用户参见 [安装与更新](install-troubleshooting.md#desktop-安装与更新)。

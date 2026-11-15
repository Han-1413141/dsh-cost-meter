# v1.9.67

## 中文

- 显示币种扩展至 26 种，切换币种保留小数位设置。官方与自定义余额可选择原币种、跟随显示币种或目录中的指定币种。
- 「设置 → 费用 → 概览 → 官方账户余额 → 余额来源」新增“DSH 登录钱包”。默认仍为“自动（模型 Key 优先）”；手选账号和专用余额 Key 始终优先。切换后保存选择、取消旧请求并重建对账基准。
- 多账号列表支持查看余额、切换、改名和删除，侧栏同时显示各账号余额。空凭据不计数，相同 Key 合并显示，单账号保留原样。
- 修复调整余额币种、官方渠道过滤、隐藏或对账开关后，余额行暂时消失的问题。
- 修正凭据说明：已验证的 DSH 0.2.2-rc.1 / rc.3 优先读取凭据文件，再读取环境变量。

感谢 [@Aaryan-Thakur](https://github.com/Aaryan-Thakur) 在 [#506](https://github.com/Han-1413141/dsh-cost-meter/pull/506) 提供币种扩展、余额展示修复和测试，[@mikechen25](https://github.com/mikechen25) 在 [#507](https://github.com/Han-1413141/dsh-cost-meter/issues/507) 提供余额来源需求与复现，以及 [@7WhiteChocolate](https://github.com/7WhiteChocolate) 在 [#502](https://github.com/Han-1413141/dsh-cost-meter/issues/502) 提供 Key 更换反馈，促成凭据来源说明核对。

## English

- Support 26 display currencies and an independent currency choice for official and custom balances, preserving the decimal setting when switching currencies.
- Add **Settings → Cost → Overview → Account balance → Balance source → DSH account wallet**. Auto still prefers the model key; selected accounts and dedicated balance keys retain priority. Changing the source saves the preference, cancels pending requests and resets reconciliation.
- Show all configured official balances in the account list and sidebar, with selection, renaming and removal. Empty slots do not count, identical keys share one row, and a single account keeps the original layout.
- Keep the balance snapshot when changing currency, official-channel filtering, hiding or reconciliation settings.
- Correct the credential documentation to reflect file-first resolution in the verified DSH 0.2.2-rc.1 and rc.3 providers.

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 DSH。Desktop 用户参见 [安装与更新](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.9.67/docs/install-troubleshooting.md#desktop-安装与更新)。

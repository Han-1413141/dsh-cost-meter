# v1.9.61

## 中文

- OpenDesign 额度卡新增“一键获取额度凭据”。在浏览器批准设备码授权后，插件保存控制面密钥、读取当前工作区并刷新额度。
- 授权绑定发起时的账号和工作区设置。等待期间切换账号、修改设置或卸载插件会取消旧结果。
- 同一凭据槽位的自动授权、手工保存和清除操作按顺序完成，后提交的手工操作优先。
- 修正 OpenDesign 取消提示，补充中英文、浅深色和窄屏交互验证。

入口为 **费用 → 额度 → OpenDesign → 一键获取额度凭据**。授权页由 DSH 宿主打开，授权链接与验证码可在宿主日志查看。[配置说明](opendesign-billing.md)

感谢 [@Lu2O3GaN](https://github.com/Lu2O3GaN) 在 [#485](https://github.com/Han-1413141/dsh-cost-meter/pull/485) 提供设备码授权流程、额度按钮、文档与初始回归测试。

## English

- Add **Get quota credential** to the OpenDesign quota card. Approve device authorization in the browser to store the control key, read the current workspace and refresh quota.
- Bind authorization to the starting account and workspace settings. Account changes, settings changes and plugin disposal cancel stale results.
- Serialize authorization, manual save and clear operations for each credential slot. Later manual operations take effect after earlier writes.
- Correct cancellation messages and verify the bilingual button in light, dark and narrow layouts.

Open **Cost → Quotas → OpenDesign → Get quota credential**. The DSH host opens the approval page and logs its link and code. [Configuration](opendesign-billing.md)

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 `dsh web`。Desktop 用户参见 [安装与更新](install-troubleshooting.md#desktop-安装与更新)。

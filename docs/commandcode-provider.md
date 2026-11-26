# CommandCode

在 DSH Web 中打开「设置 → 费用 → CommandCode」。启用推理服务后，也可在「设置 → 模型」的 Command Code 条目展开同一编辑器。只使用额度统计时，保留「费用 → 额度」里的 CommandCode 卡片即可。若独立的 CommandCode 插件已注册同名推理服务，先选定要使用的插件，再启用对应服务。

原生推理需要宿主提供模型目录、流式推理及附件接口，已在 DSH 0.2.2-rc.5 验证。使用较早的宿主时仍可使用原有额度卡。

## 连接与账户

选择「默认账号」即可复用已有的 `COMMANDCODE_API_KEY`。选择「测试连接」会向 CommandCode 验证密钥，页面显示凭据来源和上次验证时间。使用浏览器登录时，点击「使用浏览器登录」，再打开授权页。授权页通过 DSH 所在电脑的回环地址返回结果。远程部署请在 DSH 主机上完成浏览器登录，或在编辑器输入 API Key 并选择「验证并保存密钥」。

每个账号可以同时用于额度查询和推理。新增账号后，选中它并保存自己的密钥，再按需勾选「允许使用此账号推理」。已有的额外查询账号需显式加入推理轮换。查询和显示哪些账号由原有额度卡控制。删除额外账号会清除其已保存的密钥、额度查询条目和推理分配。环境变量提供的密钥须在 DSH 宿主的启动环境中修改。

## 模型、请求与用量

连接后刷新模型目录，选择要编辑的模型。收藏和可见性控制 DSH 模型选择器，显示名称只影响界面。模型可单独设置上下文长度、输出上限、推理强度和优先账号。目录显示服务所提供的规格及已知的套餐可用性。账号轮换受启用的账号、首选账号、模型分配及各账号实际可用状态影响。

「隐私与请求」可调整协议、超时和重试次数。费用计量仅向 `https://api.commandcode.ai` 发送 CommandCode 凭据。模型推理零数据保留（ZDR）默认关闭，启用后模型请求携带 `x-cmd-zdr: 1`，没有支持 ZDR 的容量时请求失败。开启网页搜索后，搜索数据按所选服务提供商的条款处理。[Provider API](https://commandcode.ai/docs/provider) · [Zero Data Retention](https://commandcode.ai/docs/resources/zdr)

「用量」标出最近服务账号及当前编辑的账号，可分别刷新。窗口百分比为已用量；月度积分与套餐按接口返回值显示。模型费用、调用详情和历史统计继续使用费用计量的现有账本。本页提供 Web 操作入口，未提供独立的 TUI 设置页。

## English

Open **Settings → Cost → CommandCode**. Enable inference to register the Command Code entry in DSH Models, where the same editor is available. For quota monitoring alone, use the existing card in **Cost → Quotas**. If another plugin already owns the route, choose one provider before enabling inference.

Select **Default account** to reuse your existing `COMMANDCODE_API_KEY`. **Test connection** validates the credential. For browser login, choose **Sign in to Command Code** and open the authorization link on the machine running DSH. For a remote or headless host, enter an API key and choose **Validate and save key**. Keys are validated and stored on the host. Change environment credentials in the DSH launch environment.

Under **Accounts and rotation**, add or rename accounts, enable each serving account and choose a preferred one. Existing quota-query accounts only enter rotation when enabled. The quota card still controls the accounts queried and shown there. Removing an extra account clears its stored credential, quota entry and inference assignments.

Refresh the model catalogue to set visibility, favourites, display names, token limits, reasoning effort and per-model account preferences. The editor shows catalogue metadata and known plan access. **Privacy and requests** controls protocol selection, timeout, retries, web search and inference ZDR. The CommandCode origin is fixed. ZDR is off by default and requests fail if the upstream cannot honour it. Search is subject to the chosen service’s data policy.

**Usage** identifies the last serving account and the account being edited. Refresh either to read its used percentage, reset times, reported plan and monthly credits. Inference calls use the regular Cost Meter ledger and statistics. Configuration is available in the Web UI. This integration has no dedicated TUI settings page.

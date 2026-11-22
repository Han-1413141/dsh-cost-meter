// Loaded only when the user opens usage settings. No storage scan in the state poller.
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.billing-storage.js',
  factory: require => {
    const { createElement: el, useEffect, useRef, useState } = require('react')
    function BillingStorage({ state, api, draft, setDraft, locale, disabled }) {
      const config = draft ?? state.config, days = config.billingStorageRetentionDays ?? 7
      const text = (zh, en) => locale === 'en' ? en : zh
      const [data, setData] = useState(null), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false)
      const [error, setError] = useState(''), [message, setMessage] = useState(''), generation = useRef(0)
      const bytes = value => value < 1024 ? value + ' B' : value < 1048576 ? (value / 1024).toFixed(1) + ' KiB' : (value / 1048576).toFixed(1) + ' MiB'
      const time = value => value == null ? '—' : new Date(value).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN')
      const scan = async (apply = false, showConfirmation = false) => {
        const request = ++generation.current
        setBusy(true); setError(''); setConfirm(false); setMessage('')
        try {
          const result = await api.billingStorage({ retentionDays: days, apply })
          if (request !== generation.current) return
          if (apply) {
            setMessage(text(`已归档 ${result.archivedStreams} 条记录，移除 ${result.removedFiles} 个文件，释放 ${bytes(result.releasedBytes)}。`, `Archived ${result.archivedStreams} streams, removed ${result.removedFiles} files and released ${bytes(result.releasedBytes)}.`))
            const current = await api.billingStorage({ retentionDays: days, apply: false })
            if (request === generation.current) setData(current)
          } else { setData(result); setConfirm(showConfirmation) }
        } catch (cause) { if (request === generation.current) setError(String(cause?.message ?? cause)) }
        finally { if (request === generation.current) setBusy(false) }
      }
      useEffect(() => { setData(null); void scan(); return () => { generation.current++ } }, [days, api])
      const available = data && data.retentionDays === days && data.streams.eligibleFiles + data.groups.eligibleFiles > 0
      return el('section', { className: 'cm-budget', 'data-billing-storage': true },
        el('h3', { className: 'cm-h' }, text('计费历史存储', 'Billing history storage')),
        el('p', { className: 'cm-note' }, text('自动维护每小时检查一次：旧的已完成计费流合并压缩，过期请求回执删除。账本、调用记录和历史费用明细保留。', 'Hourly maintenance compresses completed streams and removes expired request receipts. The ledger, call records and historical cost details are retained.')),
        el('label', { className: 'cm-field' }, text('原始辅助文件保留时间', 'Keep original auxiliary files'),
          el('select', { value: days, disabled: busy, onChange: event => { setConfirm(false); setDraft({ ...config, billingStorageRetentionDays: Number(event.target.value) }) } },
            [7, 30, 0].map(value => el('option', { key: value, value }, value ? text(`${value} 天`, `${value} days`) : text('全部保留（关闭自动清理）', 'Keep all (disable cleanup)'))))),
        el('label', { className: 'cm-check' }, el('input', { type: 'checkbox', role: 'switch', checked: config.billionContextEnabled !== false, disabled: busy, onChange: event => setDraft({ ...config, billionContextEnabled: event.target.checked }) }),
          text('启用 billion-context 辅助计量', 'Enable billion-context auxiliary measurement')),
        el('p', { className: 'cm-note' }, text('关闭后，新请求仅使用宿主计费。在途请求按原方式完成，历史分片按所选天数保留。', 'When off, new requests use host billing. Requests already in progress finish normally. Existing files follow the selected retention period.')),
        data ? el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: '12px', margin: '12px 0' } },
          [['streams', text('计费流', 'Streams')], ['groups', text('请求回执', 'Request receipts')], ['archives', text('压缩归档', 'Compressed archives')]].map(([key, title]) => {
            const value = data[key]
            return el('div', { key, className: 'cm-card' }, el('strong', null, title),
              el('p', { className: 'cm-num' }, text(`${value.files} 个文件`, `${value.files} files`) + ' · ' + bytes(value.bytes)),
              el('p', { className: 'cm-note' }, text('最早：', 'Oldest: ') + time(value.oldestAt)),
              el('p', { className: 'cm-note' }, text('最新：', 'Newest: ') + time(value.newestAt)))
          })) : null,
        error ? el('p', { className: 'cm-msg err', role: 'alert' }, error) : null,
        message ? el('p', { className: 'cm-msg', role: 'status' }, message) : null,
        busy ? el('p', { role: 'status' }, text('正在处理…', 'Working…')) : null,
        confirm && data ? el('div', { role: 'group', 'aria-label': text('确认清理', 'Confirm cleanup') },
          el('p', null, text(`将归档 ${data.streams.eligibleFiles} 条计费流、删除 ${data.groups.eligibleFiles} 个回执文件，涉及 ${data.sessions} 个会话，预计释放 ${bytes(data.reclaimableBytes)}。`, `Archive ${data.streams.eligibleFiles} streams and remove ${data.groups.eligibleFiles} receipt files across ${data.sessions} sessions; estimated release: ${bytes(data.reclaimableBytes)}.`)),
          el('p', { className: 'cm-note' }, text('正在使用或无法确认完成的文件会保留；实际数量以执行结果为准。', 'Active files and records without a completion receipt are retained; final counts may differ.')),
          el('div', { className: 'cm-buttons' },
            el('button', { type: 'button', className: 'cm-btn', disabled: disabled || busy || !available, onClick: () => scan(true) }, text('确认清理', 'Confirm cleanup')),
            el('button', { type: 'button', className: 'cm-btn', disabled: busy, onClick: () => setConfirm(false) }, text('取消', 'Cancel'))))
          : el('div', { className: 'cm-buttons' },
            el('button', { type: 'button', className: 'cm-btn', disabled: disabled || busy || days === 0, onClick: () => scan(false, true) }, text('预览清理', 'Preview cleanup')),
            el('button', { type: 'button', className: 'cm-btn', disabled: busy, onClick: () => scan() }, text('刷新统计', 'Refresh storage'))))
    }
    return { mount: () => BillingStorage }
  },
})

    function PeakPanel(props) {
      const { state, draft, setDraft, t } = props
      const { peakPhaseAt, resolveLocale, peakNoticeEl } = props.peakHelpers
      const config = state.config
      const setField = (field, value) => {
        if (draft === null) return
        setDraft({ ...draft, [field]: value })
      }
      // 预览与状态行用草稿值,切换开关/样式即时可见效果。
      const previewConfig = draft === null ? config : { ...config, ...draft }
      const locale = resolveLocale(previewConfig) === 'en' ? 'en' : 'zh-CN'
      const timeZone = peakTimeZone(previewConfig)
      const dateText = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(Date.parse(value)) : t('unknown')
      const peakStatusText = (() => {
        if (previewConfig.peakEnabled !== true) return t('peakOff')
        const eff = Date.parse(previewConfig.peakEffectiveAt || '')
        const now = Date.now()
        if (Number.isFinite(eff) && now < eff) {
          return t('peakNotEffective', { time: dateText(previewConfig.peakEffectiveAt) })
        }
        const windows = previewConfig.peakWindows ?? []
        // 周末全谷价新规:处于周末区间时状态行显示「周末时段——全谷价」(与时段条一致)。
        const view = peakPhaseAt(now, windows, previewConfig.peakHolidays)
        if (view === null) return t('offPeakActive')
        if (view.holiday === true) return t('holidayAllOffPeak')
        if (view.weekend === true) return t('weekendAllOffPeak')
        return view.inPeak ? t('peakActive') : t('offPeakActive')
      })()
      const peakText = (previewConfig.peakWindows?.length ?? 0) > 0
        ? t('peakSummary', {
          windows: peakWindowText(previewConfig.peakWindows, previewConfig, locale, Date.now()),
          zone: timeZone,
          time: dateText(previewConfig.peakEffectiveAt),
          status: peakStatusText,
        })
        : t('noPeakWindows', { status: peakStatusText })
      return el('div', { className: 'cm-budget' },
        el(PeakTimeZoneControl, { config: previewConfig, locale, onChange: value => setField('peakTimeZone', value) }),
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('peakPanelTitle')),
          el('label', { className: 'cm-check' },
            el('input', {
              type: 'checkbox',
              checked: draft?.peakEnabled !== false,
              onChange: event => setField('peakEnabled', event.target.checked),
            }),
            el('span', null, t('peakEnabledLabel')))),
        el('div', { className: 'cm-grid' },
          el('div', { className: 'cm-field' },
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.peakNotice !== false,
                onChange: event => setField('peakNotice', event.target.checked),
              }),
              el('span', null, t('peakNoticeLabel')))),
          el('div', { className: 'cm-field' },
            el('label', null, t('peakStyleLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.peakStyle ?? 'compact',
              onChange: event => setField('peakStyle', event.target.value),
            },
              el('option', { value: 'progress' }, resolveLocale(draft) === 'en' ? 'Time progress' : '时间进度条'),
              el('option', { value: 'compact' }, t('peakStyleCompact')),
              el('option', { value: 'classic' }, t('peakStyleClassic'))))),
        el('div', { className: 'cm-grid' },
          el('div', { className: 'cm-field' },
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.peakAlertEnabled !== false,
                onChange: event => setField('peakAlertEnabled', event.target.checked),
              }),
              el('span', null, t('peakAlertLabel')))),
          el('div', { className: 'cm-field' },
            el('label', null, t('peakAlertAheadLabel')),
            el('input', {
              className: 'cm-input narrow', type: 'number', min: '1', max: '30', step: '1',
              value: String(typeof draft?.peakAlertAhead === 'number' && Number.isFinite(draft.peakAlertAhead) && draft.peakAlertAhead >= 1 && draft.peakAlertAhead <= 30 ? draft.peakAlertAhead : 2),
              onChange: event => {
                const parsed = Number(event.target.value)
                if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 30) setField('peakAlertAhead', parsed)
              },
            })),
          el('div', { className: 'cm-field' },
            el('label', null, t('peakAlertTargetLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.peakAlertTarget === 'peak' || draft?.peakAlertTarget === 'offpeak' ? draft.peakAlertTarget : 'both',
              onChange: event => setField('peakAlertTarget', event.target.value),
            },
              el('option', { value: 'both' }, t('peakAlertTargetBoth')),
              el('option', { value: 'peak' }, t('peakAlertTargetPeak')),
              el('option', { value: 'offpeak' }, t('peakAlertTargetOffPeak'))))),
        el('div', { className: 'cm-grid' },
          el('div', { className: 'cm-field' },
            el('label', null, t('peakAlertPositionLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.peakAlertPosition === 'center' ? 'center' : 'corner',
              onChange: event => setField('peakAlertPosition', event.target.value),
            },
              el('option', { value: 'corner' }, t('peakAlertPositionCorner')),
              el('option', { value: 'center' }, t('peakAlertPositionCenter')))),
          el('div', { className: 'cm-field' },
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.peakAlertWebNotify === true,
                onChange: event => {
                  setField('peakAlertWebNotify', event.target.checked)
                  // 开启需用户手势申请浏览器通知权限(地址栏授权)。
                  if (event.target.checked && window.Notification && Notification.permission === 'default') {
                    // 旧 Safari 的 requestPermission 不返回 Promise,包一层防抛错。
                    Promise.resolve(Notification.requestPermission()).catch(() => {})
                  }
                },
              }),
              el('span', null, t('peakAlertWebNotifyLabel'))),
            el('p', { className: 'cm-hint' }, t('peakAlertWebNotifyHint')))),
        el('div', { className: 'cm-field' },
          el('label', null, t('peakAlertPreviewLabel')),
          el('div', { className: 'cm-row' },
            el('button', { className: 'cm-btn', onClick: () => window.cmPeakAlertPreview?.('peak') }, t('peakAlertPreviewPeak')),
            el('button', { className: 'cm-btn', onClick: () => window.cmPeakAlertPreview?.('offpeak') }, t('peakAlertPreviewOffPeak')))),
        el('div', { className: 'cm-peak-preview' },
          draft?.peakEnabled !== false && draft?.peakNotice !== false
            ? peakNoticeEl(state, previewConfig, t)
            : el('p', { className: 'cm-hint' }, t('peakNoticeHiddenHint'))),
        el('p', { className: 'cm-hint' }, peakText),
        el('div', { className: 'cm-field' },
          el('label', null, t('peakHolidaysLabel')),
          el('input', { className: 'cm-input', defaultValue: (previewConfig.peakHolidays ?? []).join(', '),
            onBlur: event => setField('peakHolidays', event.target.value.split(/[,，\s]+/).filter(Boolean)) })),
        el('p', { className: 'cm-hint' }, t('weekendRuleNote')))
    }

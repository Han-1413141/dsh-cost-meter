    function peakProgressData(config, now) {
      const view = peakView(config, now)
      if (!view) return null
      const { start, progress } = peakPeriodProgress(config, view, now)
      const locale = resolveLocale(config) === 'en' ? 'en' : 'zh-CN'
      const timeZone = peakTimeZone(config)
      const offset = at => new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at).find(part => part.type === 'timeZoneName')?.value ?? ''
      const crossesDst = offset(start) !== offset(view.nextAtMs)
      const time = at => new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
      const day = at => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
      const label = at => {
        const clock = time(at) + (crossesDst ? ' ' + offset(at) : '')
        if (day(at) === day(now)) return clock
        const date = new Intl.DateTimeFormat(locale, { timeZone, ...(view.holiday || Math.abs(at - now) >= 7 * 86400000 ? { month: 'numeric', day: 'numeric' } : { weekday: 'short' }) }).format(at)
        return date + ' ' + clock
      }
      return { ...view, start, progress, timeZone, startText: label(start), switchTime: label(view.nextAtMs) }
    }
    function PeakProgress({ config, t, now: fixedNow, rail = false }) {
      const now = usePeakClock(config, fixedNow), view = peakProgressData(config, now)
      if (!view) return null
      const en = resolveLocale(config) === 'en', keys = phaseLabelKeys(view)
      const next = t(view.nextIntoPeak ? 'peakShort' : 'offPeakShort')
      const minutes = Math.max(1, Math.ceil((view.nextAtMs - now) / 60000))
      const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60
      const duration = days > 0
        ? (en ? days + 'd ' + hours + 'h' + (mins ? ' ' + mins + 'm' : '') : days + '天' + (hours ? hours + '小时' : '') + (mins ? mins + '分' : ''))
        : countdownText(view, now, t)
      const shortDuration = en ? (days ? days + 'd ' : '') + (hours ? hours + 'h ' : '') + (mins ? mins + 'm' : '') : (days ? days + '天' : '') + (hours ? hours + '时' : '') + (mins ? mins + '分' : '')
      const remaining = (en ? 'In ' : '剩余 ') + duration
      const change = view.switchTime + (en ? ' · ' : ' 转') + next
      const period = view.startText + ' — ' + view.switchTime
      const detail = [t(keys.notice), view.timeZone + ' · ' + period, remaining + ' · ' + change,
        (en ? 'Elapsed ' : '本时段已过 ') + view.progress.toFixed(1) + '%'].join('\n')
      const mode = config.peakTimeDisplay ?? 'both'
      const textOnly = config.sidebarTextOnly === true
      const variant = textOnly ? 'compact' : config.peakProgressVariant ?? (config.sidebarSimple ? 'simple' : config.sidebarStyle === 'compact' ? 'compact' : 'full')
      const phaseText = view.holiday ? (en ? 'Holiday · off-peak' : '节假日 · 全天谷价') : view.weekend ? (en ? 'Weekend · off-peak' : '周末 · 全天谷价') : t(keys.short)
      const shortPhase = view.holiday ? (en ? 'Holiday' : '假日') : view.weekend ? (en ? 'Weekend' : '周末') : t(keys.short)
      const phase = text => el('span', { className: 'cm-peak-progress-phase' }, el('i', { 'aria-hidden': true }), text)
      const track = textOnly ? null : el('div', { className: 'cm-peak-progress-track', role: 'progressbar', 'aria-label': en ? 'Current pricing period elapsed' : '当前计价时段已过进度', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(view.progress * 10) / 10, 'aria-valuetext': detail },
        el('span', { className: 'cm-peak-progress-fill', style: { [rail ? 'height' : 'width']: view.progress + '%' } }))
      const compactTime = mode === 'countdown' ? shortDuration : mode === 'switch' ? view.switchTime + ' → ' + next : view.switchTime + ' · ' + shortDuration
      const content = rail ? el(Fragment, null, track, el('span', { className: 'cm-peak-progress-rail-label' }, shortPhase))
        : variant === 'summary' ? el(Fragment, null,
            el('div', { className: 'cm-peak-progress-head' }, el('span', { className: 'cm-peak-summary-left' }, phase(shortPhase), mode !== 'switch' ? el('span', { className: 'cm-peak-summary-countdown' }, (en ? 'In ' : '剩余 ') + shortDuration) : null), mode !== 'countdown' ? el('span', { className: 'cm-peak-progress-time' }, change) : null), track)
        : variant === 'compact' ? el(Fragment, null, phase(shortPhase), track, el('span', { className: 'cm-peak-progress-time' }, compactTime))
        : variant === 'simple' ? el(Fragment, null,
            el('div', { className: 'cm-peak-progress-head' }, phase(view.holiday || view.weekend ? shortPhase + (en ? ' · off-peak' : '谷价') : shortPhase), el('span', { className: 'cm-peak-progress-time' }, mode === 'switch' ? change : remaining)),
            track,
            mode === 'both' ? el('div', { className: 'cm-peak-progress-meta' }, el('span', null, change)) : null)
        : el(Fragment, null,
            el('div', { className: 'cm-peak-progress-head' },
              phase(phaseText),
              el('span', { className: 'cm-peak-progress-time' }, mode === 'switch' ? change : remaining)),
            track,
            mode === 'both' ? el('div', { className: 'cm-peak-progress-meta' }, el('span', null, view.startText + (en ? ' start' : ' 开始')), el('span', null, change)) : null)
      return el(Tooltip, { portal: true, label: detail, side: 'right', delayMs: 300 },
        el('div', { 'data-cm-display': 'peak', 'aria-label': detail, className: 'cm-peak-progress ' + (view.inPeak ? 'peak' : 'off') + (rail ? ' rail' : ' variant-' + variant) + (textOnly ? ' text-only' : ''), 'data-variant': variant, 'data-progress': view.progress, 'data-switch-at': view.nextAtMs }, content))
    }

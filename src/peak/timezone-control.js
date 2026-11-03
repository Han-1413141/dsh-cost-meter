function PeakTimeZoneControl({ config, onChange, locale }) {
  const en = locale === 'en', zone = peakTimeZone(config)
  return el('label', { className: 'cm-field', 'data-display-option': 'peak-timezone' },
    el('span', null, en ? 'Peak display timezone' : '峰谷显示时区'),
    el('select', { className: 'cm-input', value: config.peakTimeZone ?? 'auto', onChange: event => onChange(event.target.value),
      'aria-label': en ? 'Peak display timezone' : '峰谷显示时区' },
      el('option', { value: 'auto' }, (en ? 'System timezone · ' : '跟随系统 · ') + peakTimeZone({})),
      ...peakTimeZoneOptions(config).map(value => el('option', { key: value, value }, value))),
    el('span', { className: 'cm-hint' }, (en ? 'Displaying in ' : '当前显示：') + zone + (en
      ? '. Daylight saving adjusts automatically. Provider billing periods stay unchanged.'
      : '。自动处理夏令时，厂商计费时段保持不变。')))
}

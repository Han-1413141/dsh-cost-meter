const unsafe = key => ['__proto__', 'prototype', 'constructor'].includes(String(key))
const own = (value, key) => value !== null && typeof value === 'object' && !unsafe(key) && Object.hasOwn(value, key) ? value[key] : undefined
export function balanceNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value !== 'string' || !/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(value.trim())) return NaN
  return Number(value.trim())
}
function pathValue(data, path) {
  if (typeof path !== 'string' || !path || path.length > 1024) return undefined
  return path.split('.').reduce(own, data)
}
const numeric = value => {
  const number = balanceNumber(value)
  if (!Number.isFinite(number)) throw Error('missing or non-numeric balance field')
  return number
}
const functions = { min: Math.min, max: Math.max, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil }

// Bounded arithmetic grammar; identifiers only read own JSON fields.
export function balanceExpression(data, expression) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 2048) return null
  try {
    const tokens = [], source = expression.trim()
    let offset = 0
    while (offset < source.length) {
      const rest = source.slice(offset), space = rest.match(/^\s+/)
      if (space) { offset += space[0].length; continue }
      const match = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_$][\w$]*|^"[^"\\]*"|^'[^'\\]*'|^\*\*|^[+*/%().,\[\]-]/)
      if (!match || tokens.length >= 256) return null
      tokens.push(match[0]); offset += match[0].length
    }
    let cursor = 0, depth = 0
    const take = token => tokens[cursor] === token && (++cursor, true)
    const expect = token => { if (!take(token)) throw Error('invalid formula') }
    const primary = () => {
      if (++depth > 32) throw Error('formula too deep')
      let value, token = tokens[cursor++]
      if (token === '+' || token === '-') value = numeric(primary()) * (token === '-' ? -1 : 1)
      else if (token === '(') { value = add(); expect(')') }
      else if (/^(?:\d|\.\d)/.test(token ?? '')) value = numeric(token)
      else if (/^[A-Za-z_$][\w$]*$/.test(token ?? '')) {
        if (take('(')) {
          if (!Object.hasOwn(functions, token)) throw Error('unknown function')
          const args = [numeric(add())]
          while (take(',')) { if (args.length >= 32) throw Error('too many arguments'); args.push(numeric(add())) }
          expect(')')
          if (!['min', 'max'].includes(token) && args.length !== 1) throw Error('invalid argument count')
          value = numeric(functions[token](...args))
        } else {
          value = own(data, token)
          while (tokens[cursor] === '.' || tokens[cursor] === '[') {
            let key
            if (take('.')) { key = tokens[cursor++]; if (!/^[A-Za-z_$][\w$]*$/.test(key ?? '')) throw Error('invalid field') }
            else {
              expect('['); key = tokens[cursor++]
              if (/^\d+$/.test(key ?? '')) key = Number(key)
              else if (/^(?:"[^"\\]*"|'[^'\\]*')$/.test(key ?? '')) key = key.slice(1, -1)
              else throw Error('invalid index')
              expect(']')
            }
            value = own(value, key)
          }
        }
      } else throw Error('invalid operand')
      depth--; return value
    }
    const power = () => { const a = numeric(primary()); return take('**') ? numeric(a ** power()) : a }
    const multiply = () => {
      let a = power()
      while (['*', '/', '%'].includes(tokens[cursor])) {
        const op = tokens[cursor++], b = power()
        if (op !== '*' && b === 0) throw Error('division by zero')
        a = numeric(op === '*' ? a * b : op === '/' ? a / b : a % b)
      }
      return a
    }
    const add = () => {
      let a = multiply()
      while (['+', '-'].includes(tokens[cursor])) { const op = tokens[cursor++], b = multiply(); a = numeric(op === '+' ? a + b : a - b) }
      return a
    }
    const result = add()
    return cursor === tokens.length ? numeric(result) : null
  } catch { return null }
}

export function extractByRule(data, rule) {
  let steps = 0
  const evaluate = (root, item, depth = 0) => {
    if (++steps > 4096 || depth > 24) return null
    if (typeof item === 'number') return Number.isFinite(item) ? item : null
    if (typeof item === 'string') {
      const value = pathValue(root, item), number = balanceNumber(value)
      return Number.isFinite(number) ? number : typeof value === 'string' ? value : null
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    if (Object.hasOwn(item, 'expression')) return balanceExpression(root, item.expression)
    if (item.op === 'sum') {
      const rows = pathValue(root, item.path)
      if (!Array.isArray(rows) || rows.length > 1000) return null
      let total = 0
      for (const row of rows) {
        const value = balanceNumber(item.value === undefined ? row : evaluate(row, item.value, depth + 1))
        if (!Number.isFinite(value)) return null
        total += value
      }
      return Number.isFinite(total) ? total : null
    }
    let args = item.args
    if (!args && ['add', 'subtract'].includes(item.op)) args = item.paths
    if (!args && ['divide', 'multiply'].includes(item.op) && typeof item.path === 'string') args = [item.path, balanceNumber(item.by)]
    if (!item.op && typeof item.path === 'string') return evaluate(root, item.path, depth + 1)
    if (!Array.isArray(args) || args.length > 64 || (!args.length && item.op !== 'add')) return null
    const values = args.map(arg => balanceNumber(evaluate(root, arg, depth + 1)))
    if (!values.every(Number.isFinite)) return null
    let result
    switch (item.op) {
      case 'add': result = values.reduce((a, b) => a + b, 0); break
      case 'subtract': result = values.reduce((a, b) => a - b); break
      case 'multiply': result = values.reduce((a, b) => a * b, 1); break
      case 'divide': if (values.length < 2 || values.slice(1).includes(0)) return null; result = values.reduce((a, b) => a / b); break
      case 'min': result = Math.min(...values); break
      case 'max': result = Math.max(...values); break
      default: return null
    }
    return Number.isFinite(result) ? result : null
  }
  return evaluate(data, rule)
}

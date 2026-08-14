/** 本地余额接口模拟:仅用于文档截图,返回固定示例数据。 */
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 3101)
createServer((req, res) => {
  if (req.url === '/user/balance') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      is_available: true,
      balance_infos: [{
        currency: 'CNY',
        total_balance: '42.50',
        granted_balance: '10.00',
        topped_up_balance: '32.50',
      }],
    }))
    return
  }
  res.writeHead(404)
  res.end()
}).listen(port, '127.0.0.1', () => {
  console.log(`mock balance on http://127.0.0.1:${port}`)
})

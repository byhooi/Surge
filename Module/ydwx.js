const cookieName = 'MixCapp'
const cookieKey = 'cookie_mixcapp'
const bodyKey = 'body_mixcapp'
const headersKey = 'headers_mixcapp'
const signInUrl = 'https://app.mixcapp.com/mixc/gateway'

function saveRequestData() {
  const cookie = $request.headers['Cookie']
  const body = $request.body
  const headers = $request.headers

  if (cookie && body && headers) {
    const savedCookie = $persistentStore.write(cookie, cookieKey)
    const savedBody = $persistentStore.write(body, bodyKey)
    const savedHeaders = $persistentStore.write(JSON.stringify(headers), headersKey)

    if (savedCookie && savedBody && savedHeaders) {
      $notification.post(`${cookieName}`, '数据保存成功！', 'Cookie、请求体和请求头已成功保存')
    } else {
      $notification.post(`${cookieName}`, '数据保存失败', '请检查脚本配置')
    }
  }
  $done({})
}

function signIn() {
  const cookie = $persistentStore.read(cookieKey)
  const body = $persistentStore.read(bodyKey)
  const headers = JSON.parse($persistentStore.read(headersKey) || '{}')

  if (!cookie || !body || !headers) {
    $notification.post('MixCapp 签到', '失败', '未找到必要的数据，请先获取数据')
    $done()
    return
  }

  headers['Cookie'] = cookie

  const myRequest = {
    url: signInUrl,
    headers: headers,
    body: body
  }

  $httpClient.post(myRequest, function(error, response, data) {
    if (error) {
      $notification.post('MixCapp 签到', '失败', '请求失败，网络错误')
      $done()
    } else {
      const result = JSON.parse(data)
      if (result.code === 0) {
        $notification.post('MixCapp 签到', '成功', '签到成功')
      } else {
        $notification.post('MixCapp 签到', '失败', `签到失败，错误码：${result.code}`)
      }
      $done()
    }
  })
}

// 判断脚本运行环境，获取数据还是定时签到
if (typeof $request !== 'undefined') {
  saveRequestData()
} else {
  signIn()
}

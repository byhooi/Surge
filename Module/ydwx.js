const cookieName = 'MixCapp'
const cookieKey = 'cookie_mixcapp'
const url = 'https://app.mixcapp.com/mixc/gateway'
const signInHeaders = {
  'Host': 'app.mixcapp.com',
  'Accept': 'application/json, text/plain, */*',
  'Sec-Fetch-Site': 'same-origin',
  'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Mode': 'cors',
  'Content-Type': 'application/x-www-form-urlencoded',
  'Origin': 'https://app.mixcapp.com',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) crland/4.4.0 grayscale/0 /MIXCAPP/3.57.1 AnalysysAgent/Hybrid',
  'Referer': 'https://app.mixcapp.com/m/m-8602A101/signIn?appVersion=3.57.1&mallNo=8602A101&timestamp=1716354622662&showWebNavigation=true&hideNativeNavigation=true',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'empty'
}

const signInBody = 'mallNo=8602A101&appId=68a91a5bac6a4f3e91bf4b42856785c6&platform=h5&imei=AB6DBA4A-F1C7-4A10-AD49-15AD2E3C627E&appVersion=3.57.1&osVersion=17.5.1&action=mixc.app.memberSign.nextStep&apiVersion=1.0&timestamp=1716354625861&deviceParams=eyJwaG9uZSI6IjE4Njg5MjIxNDQ2IiwiZGV2aWNlIjoiaVBob25lMTMsMiIsImRldmljZUlkIjoiQnc5amR6dVN3VkVESEJVRE5RcWE5eWtcL1A1SmhhQWJQbE5YbCtFRmJYWWQzSDlyODBUdFlRTmFOSW83b0s3MUpqN1V6Rzl1eDVWWCtndThpcGlUOWNrQT09IiwibG9jYXRpb24iOnsiZ3BzTG9uZ2l0dWRlIjoiMTE0LjEzMTQiLCJncHNMYXRpdHVkZSI6IjIyLjU5MjUifSwiZGV2aWNlTmFtZSI6ImlQaG9uZSJ9&t=1716354625856&date=2024-05-22%2001%3A10%3A25&token=4398a759e28e436caa687847048a5dc1&params=eyJtYWxsTm8iOiI4NjAyQTEwMSJ9&sign=0f140f124bc86af6846238a375a720cf'

function saveCookie() {
  const cookie = $request.headers['Cookie']
  if (cookie) {
    const saved = $persistentStore.write(cookie, cookieKey)
    if (saved) {
      $notification.post(`${cookieName}`, 'Cookie 保存成功！', 'Cookie 已成功保存')
    } else {
      $notification.post(`${cookieName}`, 'Cookie 保存失败', '请检查脚本配置')
    }
  }
  $done({})
}

function signIn() {
  const cookie = $persistentStore.read(cookieKey)
  if (!cookie) {
    $notification.post('MixCapp 签到', '失败', '未找到 Cookie，请先获取 Cookie')
    $done()
    return
  }

  signInHeaders['Cookie'] = cookie

  const myRequest = {
    url: url,
    headers: signInHeaders,
    body: signInBody
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

// 判断脚本运行环境，获取 Cookie 还是定时签到
if (typeof $request !== 'undefined') {
  saveCookie()
} else {
  signIn()
}

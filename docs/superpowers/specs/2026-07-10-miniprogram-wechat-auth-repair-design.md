# 小程序微信登录与注册状态修复设计

## 目标

- 修复完成注册后“我的”仍显示未登录的问题。
- 让真实微信登录使用当前小程序 AppID 和服务器端 AppSecret 正常完成 `code2Session`。
- 实现真实微信手机号授权，不再在非 Mock 环境固定失败。
- AppSecret 只存在于服务器环境变量，不写入前端、仓库或日志。

## 当前问题

完成注册接口会返回 `accountState: "registered"` 和 `user`，并已在数据库事务中将当前小程序 session 绑定到新用户，但注册完成页忽略了响应，未同步小程序全局状态。

真实微信登录依赖 `WECHAT_MINI_APP_ID` 和 `WECHAT_MINI_APP_SECRET`。当前生产环境模板未声明这两项，在线微信登录接口实测返回 500。

手机号授权后端当前只有 Mock 实现；真实环境直接抛出“requires access_token wiring”，所以授权按钮必然失败。

## 服务端微信客户端

`src/server/wechat.ts` 继续负责所有微信服务端 API 调用，并增加两项能力：

1. 获取小程序接口调用凭证。使用 `WECHAT_MINI_APP_ID` 和 `WECHAT_MINI_APP_SECRET` 请求微信 `cgi-bin/token` 接口，在进程内缓存凭证，并在过期前五分钟刷新。
2. 换取手机号。将小程序按钮返回的临时 `code` 提交到微信 `wxa/business/getuserphonenumber` 接口，读取 `phone_info.phoneNumber`。

微信接口的非零 `errcode`、缺失字段和网络错误都在服务端日志中保留错误码，但响应给小程序时只返回安全、可读的中文提示，不泄露 AppSecret、access token 或完整请求地址。

`WECHAT_MOCK=true` 时保持现有 Mock 行为，避免破坏本地认证冒烟测试。

## 小程序状态同步

注册完成页保存 `POST /api/auth/complete-registration` 的响应。成功后立即更新：

- `getApp().globalData.accountState`
- `getApp().globalData.user`

然后返回上一页。“我的”页面现有 `onShow -> load -> refreshAccountStatus` 会再从后端确认 session 状态，形成前端即时更新和服务端复核两层保障。

微信登录继续由 `miniprogram/app/utils/auth.js` 处理。增加对 `wx.login` 未返回 code 的校验，避免向后端发送空 code。

## 生产配置

`.env.production.example` 增加：

```dotenv
WECHAT_MINI_APP_ID=REDACTED_WECHAT_MINI_APP_ID
WECHAT_MINI_APP_SECRET=
```

真实 AppSecret 由部署人员填写到服务器 `.env.production`。仓库不保存真实值。Docker Compose 已通过 `env_file` 加载该文件，无需在 Compose 中重复声明。

## 错误处理

- 缺少 AppID/AppSecret：返回“微信登录配置未完成”。
- 微信 code 无效或已使用：返回“微信登录凭证无效，请重试”。
- 微信接口网络失败：返回“微信服务暂不可用，请稍后重试”。
- 手机号授权被拒绝或没有 code：保留手动填写手机号/邮箱的降级入口。
- access token 失效：清除缓存并允许下一次请求重新获取，不在客户端持久化微信 access token。

## 验证

- 扩展微信服务端模块的 Mock 路径检查，确认登录和手机号授权不访问真实微信接口。
- 运行小程序认证冒烟测试，覆盖微信登录、手机号回填、完成注册和账号状态查询。
- 运行 `node --check` 检查修改的小程序 JavaScript。
- 运行 `npm run lint` 检查 TypeScript。
- 部署后使用真实小程序调用微信登录和手机号授权；本地环境不能替代真实临时 code 的最终验收。

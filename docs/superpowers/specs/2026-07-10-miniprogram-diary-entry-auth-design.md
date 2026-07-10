# 小程序默认灵感页与登录分流设计

## 目标

- 小程序冷启动默认进入“灵感”页。
- 游客在灵感页看到“微信登录”，不再直接看到“完成注册”。
- 微信登录成功后，已关联 Web 账号的用户直接加载真实灵感；未关联用户自动进入关联或注册页面。

## 默认首页

微信小程序使用 `app.json` 中 `pages` 数组的第一项作为默认首页。将 `pages/diary/index` 调整到第一项，`pages/toolbox/index` 保持为 tabBar 第二项，不使用启动后跳转，避免页面闪烁。

## 灵感页状态

灵感页保留现有三种账号状态，并分别处理：

- `guest`：显示“微信登录”，点击后调用现有 `wechatLogin()`。
- `wechat_logged_in_unregistered`：显示“关联或注册”，点击进入 `pages/register-complete/index`。
- `registered`：加载并显示真实卡片和灵感册。

微信登录期间按钮显示 loading，避免重复提交。登录接口返回 `registered` 时，立即加载卡片和灵感册；返回未关联状态时，更新页面状态并自动进入关联或注册页面。登录失败时保留游客状态并显示后端返回的错误信息。

## 验证

- 检查 `app.json` 第一项为 `pages/diary/index`，tabBar 顺序保持“灵感、工具箱、我的”。
- 检查游客、未关联、已关联三种状态对应的按钮和行为。
- 运行灵感页 JavaScript 语法检查、TypeScript lint、生产构建和补丁检查。

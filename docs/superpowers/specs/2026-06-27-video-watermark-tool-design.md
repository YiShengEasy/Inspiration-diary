# 视频去水印下载工具设计

## 背景

在小程序工具箱中新增一个“视频去水印”工具。入口采用工具箱内的工具卡片，点击后进入独立页面。页面风格沿用当前小程序的暖纸背景、圆角容器、黑色按钮和荧光绿重点态，而不是照搬截图中的纯白工具页。

该功能的目标是先跑通 MVP：用户粘贴公开视频分享链接，后端调用第三方解析 provider，返回标题、封面和可下载视频地址，小程序完成预览、复制标题、复制链接和保存视频到相册。

## 范围

### 包含

- 工具箱“常用”分类新增“视频去水印”工具卡片。
- 新增小程序独立页面 `/pages/video-watermark/index`。
- 页面支持输入/粘贴/清空/解析链接。
- 解析成功后展示视频预览、标题、复制标题、复制链接、保存视频。
- 后端新增统一解析接口 `POST /api/miniprogram/video-watermark/parse`。
- 后端新增 provider 适配层，默认可先接免费/非正式 provider 用于 MVP 验证，后续可切换到 TikHub 等商业 provider。
- 小程序保存视频时使用 `wx.downloadFile` 和 `wx.saveVideoToPhotosAlbum`。

### 不包含

- 不在小程序端直连第三方解析站。
- 不绕过平台 DRM、私密内容、登录受限内容或付费内容。
- 不承诺免费 provider 的长期稳定性。
- 不在 MVP 中做多 provider 自动切换 UI，只在后端实现可替换结构。

## 用户体验

### 工具箱入口

在当前工具箱“常用”分类中加入一张工具卡片：

- 名称：视频去水印
- 描述：复制链接，解析后保存视频
- 图标：播放/视频类图标，使用当前工具箱字符图标体系
- 强调色：黑底荧光绿，和现有工具箱重点态一致

点击卡片进入独立页面，而不是在工具箱首页展开输入区域。这样不会破坏现有工具箱首页的信息结构，也能给解析结果、保存状态和错误提示留出空间。

### 独立页

页面结构：

1. 顶部导航
   - 返回按钮
   - 标题“视频去水印”
   - 微信胶囊区域由系统提供

2. 链接输入卡片
   - 标题：“粘贴视频分享链接”
   - 多行输入区域
   - 清空按钮
   - 粘贴按钮
   - 解析按钮，使用荧光绿作为主操作

3. 解析结果卡片
   - 视频预览区域
   - 时长
   - 标题/话题文本
   - 复制标题
   - 保存视频
   - 复制链接

4. 说明卡片
   - 提示“仅保存自己发布或已授权的公开视频”
   - 提示保存视频需要相册权限

### 状态

- 初始态：输入框为空，解析按钮可点击但会提示先粘贴链接。
- 输入态：用户粘贴或输入链接。
- 解析中：解析按钮 loading，禁用重复提交。
- 成功态：展示预览、标题、复制/保存按钮。
- 失败态：展示 toast 或页面内错误文案。
- 保存中：保存按钮 loading。
- 权限缺失：引导用户打开设置授权相册。

## 后端接口

### 小程序调用接口

`POST /api/miniprogram/video-watermark/parse`

鉴权：沿用小程序当前 token/session 鉴权。

请求体：

```json
{
  "url": "https://v.douyin.com/xxxx/"
}
```

响应体：

```json
{
  "title": "视频标题和话题",
  "coverUrl": "https://example.com/cover.jpg",
  "videoUrl": "https://example.com/video.mp4",
  "sourceUrl": "https://v.douyin.com/xxxx/",
  "duration": 17,
  "provider": "tikwm"
}
```

错误响应：

```json
{
  "error": "解析失败，请检查链接或稍后再试"
}
```

### 校验规则

- `url` 必须是字符串。
- 长度限制建议为 2048 字符。
- 仅允许 `http` 和 `https`。
- MVP 可先支持抖音/TikTok 分享链接，后续扩展快手、小红书。
- 后端记录 provider 失败原因，但返回给前端的错误文案保持克制。

## Provider 设计

后端内部定义统一 provider 接口：

```ts
type VideoResolveResult = {
  title: string;
  coverUrl?: string;
  videoUrl: string;
  sourceUrl: string;
  duration?: number;
  provider: string;
};

type VideoResolverProvider = {
  resolve(inputUrl: string): Promise<VideoResolveResult>;
};
```

环境变量：

```env
VIDEO_RESOLVER_PROVIDER=tikwm
VIDEO_RESOLVER_BASE_URL=https://www.tikwm.com
VIDEO_RESOLVER_API_KEY=
VIDEO_RESOLVER_TIMEOUT_MS=12000
```

### MVP provider

MVP 可以先使用免费/非正式 provider 跑通功能，例如 TikWM 类接口。它的优点是成本低，适合验证 UI 和保存流程；缺点是稳定性、限流、返回格式和可用性不可控。

为了降低风险，TikWM 只作为后端 provider，不直接暴露给小程序。后续切换到 TikHub、Apify、TikAPI 或其他商业 provider 时，小程序接口保持不变。

### 生产 provider

生产环境优先考虑有 API key、文档、套餐和稳定接口的 provider。当前候选方向：

- TikHub：更适合国内短视频平台聚合场景。
- Apify：适合 TikTok 爬取/下载类场景。
- TikAPI：适合 TikTok 数据接口。

## 小程序下载保存

保存流程：

1. 用户点击“保存视频”。
2. 小程序调用 `wx.downloadFile({ url: videoUrl })` 下载临时文件。
3. 下载成功后调用 `wx.saveVideoToPhotosAlbum({ filePath })`。
4. 成功后 toast：“已保存到相册”。
5. 如果没有相册权限，提示用户打开设置。

注意：如果第三方 provider 返回的视频地址有防盗链或过期时间，后端后续可以新增下载代理接口，把 provider URL 包装成自己的短期下载 URL。

## 错误处理

- 空链接：请输入视频分享链接。
- 非 URL：链接格式不正确。
- 不支持的平台：暂不支持这个平台。
- 解析失败：解析失败，请换个链接或稍后再试。
- 下载失败：视频下载失败，请重新解析。
- 保存失败：保存失败，请检查相册权限。
- provider 超时：解析超时，请稍后再试。

## 合规和边界

页面说明和后端行为都应限定为公开、用户自有或已授权的视频内容。功能不处理私密、付费、登录受限、DRM 或平台明确禁止下载的内容。

后端不在日志中保存完整视频下载地址和敏感 token。必要时只记录域名、平台类型、错误码和耗时。

## 测试计划

- 小程序页面可从工具箱卡片进入。
- 空链接、非法链接、失败链接均有提示。
- provider mock 成功时能展示标题、预览和按钮。
- 复制标题、复制链接可用。
- 保存视频时能触发下载和相册保存流程。
- 相册权限失败时能给出明确提示。
- 后端接口校验空 URL、非法 URL、provider 超时和 provider 返回格式异常。

## 实施顺序

1. 添加工具数据和工具箱路由入口。
2. 新增小程序视频去水印页面。
3. 新增后端解析接口和 provider 抽象。
4. 接入 MVP provider。
5. 完成复制、下载、保存和错误状态。
6. 跑 lint/build，并在微信开发者工具中验证页面和保存流程。

# P0 + P1 媒体直连与图片规格设计

## 目标

本阶段落地全端媒体流量方案的 P0 和 P1：OSS 媒体字节不再经过 ECS 转发，小程序视频不再播放前完整下载，主图、绑定图片和组合图片统一使用缩略图、详情图和原图三类用途。现有鉴权、数据归属、删除流程和本地存储开发模式保持不变。

## 交付模式

新增 `MEDIA_DELIVERY_MODE`：

- `proxy`：保持当前行为，ECS 校验后代理媒体字节，作为默认值和回退路径。
- `oss`：ECS 校验签名与资源归属后返回 `302`，跳转到短期 OSS 签名地址；客户端随后直接从 OSS 获取媒体字节。

客户端继续接收当前应用域名下的短期签名 URL，因此 DTO、缓存键和鉴权模型不需要整体改写。OSS 模式仍会产生一次轻量 ECS 鉴权请求，但图片、海报和视频分片不再占用 ECS 下行带宽。只有 `storage_provider=oss` 的资源执行跳转，本地资源始终由现有路由读取。

## 图片规格

服务端统一定义以下 OSS 处理参数，并允许通过环境变量覆盖：

| 用途 | 默认处理参数 | 使用位置 |
|---|---|---|
| `thumb-240` | `image/resize,w_240/quality,Q_70/format,webp` | 小程序三列卡片和小封面 |
| `thumb-480` | `image/resize,w_480/quality,Q_75/format,webp` | Web 卡片、小程序日卡和灵感册封面 |
| `detail-1280` | `image/resize,w_1280/quality,Q_82/format,webp` | Web 和小程序图片详情 |
| `original` | 不附加处理参数 | 用户主动下载 |
| `poster-720` | `video/snapshot,t_1000,f_jpg,w_720` | 视频播放前海报 |

主图使用 `/api/objects` 的独立用途路由；绑定图片和组合图片增加 `thumb`、`detail`、`original` 用途路由。用途必须进入签名路径，不接受未签名的查询参数切换规格。

DTO 兼容现有字段并补充用途字段：

- 卡片：`thumbnail240Url`、`thumbnailUrl`、`imageUrl`、`originalImageUrl`。
- 绑定图片和组合图片：`thumbnailUrl`、`imageUrl`、`originalImageUrl`。
- 视频：保留 `videoUrl`，海报继续使用 `posterUrl`。

列表字段指向缩略规格，详情字段指向 `detail-1280`；下载操作显式使用 `originalImageUrl`。非 OSS 或历史数据无法生成变体时，保持现有 URL 作为兼容回退。

## 小程序行为

卡片详情不再通过 `hydrateCardMedia()` 和 `wx.downloadFile` 预下载视频、海报或详情图片。`<video>` 直接使用流地址，只有播放器开始请求时才产生视频流量，并可通过 Range 分段播放。组合视频同样直接播放。

`downloadAsset()` 仅用于用户点击保存时的完整下载；普通浏览统一使用 `resolveAssetUrl()`。图片保存使用 `originalImageUrl`，避免把压缩详情图误存为原图。视频保存继续下载原视频流地址。

详情页卸载时停止所有 VideoContext，防止离开页面后继续下载。图片组件增加懒加载配置，但全面分页和首页摘要仍属于 P2，不纳入本阶段。

## Web 行为

列表继续优先使用 `thumbnailUrl`，详情优先使用 `imageUrl` 的 `detail-1280` 版本。原图下载按钮改用 `originalImageUrl`。现有视频保留 `preload="metadata"` 和 `playsInline`；关闭详情或切换卡片时卸载播放器节点，使浏览器停止后续分片请求。

绑定图片、组合封面和组合详情使用对应缩略图或详情图字段。P0 + P1 不改变每页 12 条分页，也不在本阶段拆分列表 DTO。

## 错误与回退

- `MEDIA_DELIVERY_MODE` 非法值在启动时报告配置错误。
- OSS 签名生成失败返回明确的 502，不回退到公开 URL。
- `proxy` 模式保持现有 Range 和缓存头行为。
- `oss` 模式只改变媒体响应为临时重定向；数据库权限检查失败仍返回 404 或 403。
- 签名过期后，用户重新加载卡片或详情即可获取新的应用签名 URL 和 OSS 签名 URL。
- 微信后台尚未配置 OSS HTTPS 合法域名时，可以立即切回 `MEDIA_DELIVERY_MODE=proxy`。

## 配置

环境模板新增：

```dotenv
MEDIA_DELIVERY_MODE=proxy
OSS_THUMB_240_PROCESS=image/resize,w_240/quality,Q_70/format,webp
OSS_THUMB_480_PROCESS=image/resize,w_480/quality,Q_75/format,webp
OSS_DETAIL_1280_PROCESS=image/resize,w_1280/quality,Q_82/format,webp
OSS_VIDEO_POSTER_PROCESS=video/snapshot,t_1000,f_jpg,w_720
```

生产环境首次发布保持 `proxy`。确认 OSS HTTPS 域名已加入微信 `image`、`video` 和 `downloadFile` 合法域名后，再把生产值切换为 `oss`。

## 验证

1. TypeScript、生产构建和小程序 JavaScript/JSON 语法检查通过。
2. 单元级验证图片用途到 OSS process 参数的映射，并验证非法模式拒绝启动。
3. 代理模式媒体请求继续返回 200/206，视频 Range 不回归。
4. OSS 模式媒体请求返回 302，`Location` 为短期 OSS HTTPS 签名地址且不暴露访问密钥。
5. 对 OSS 视频签名地址发送 Range 请求，确认返回 206、`Accept-Ranges` 和正确 `Content-Range`。
6. 小程序详情加载不触发播放前 `wx.downloadFile`；只有保存操作触发完整下载。
7. 列表、详情和下载分别使用缩略图、详情图和原图字段。

## 非本阶段范围

周摘要接口、搜索与收藏分页、列表 DTO 瘦身、Express 压缩和静态资源长期缓存属于 P2/P3；CDN、私有 CDN 鉴权和客户端直传 OSS 属于后续阶段。

# 📋 跨设备剪贴板

Cloudflare Workers 单文件应用：电脑手机互传文字、文件。

## 部署步骤（手机上就能操作）

1. **GitHub 新建仓库**，把这几个文件传上去：
   - `clipboard.js`
   - `wrangler.toml`
   - `.github/workflows/deploy.yml`
2. **加 Secrets**：仓库 Settings → Secrets and variables → Actions → New repository secret，
   加两个（跟影视站那套一样的值，直接复用）：
   - `CF_API_TOKEN`
   - `CF_ACCOUNT_ID`
3. **Cloudflare 建 KV**：左侧 KV → 创建命名空间（如 clipboard）→ 点进去复制 **ID**
4. **填 wrangler.toml**：在 GitHub 网页上编辑，把 KV 的 ID 和 R2 存储桶名填进去，保存
   （R2 没有就新建一个，有就复用网盘那个桶）
5. **设密码**：第一次部署成功后，去 Cloudflare → 这个 Worker → 设置 → 变量和机密 → 添加机密 `PASSWORD`
6. 以后改 `clipboard.js` 直接在 GitHub 网页上改，保存就自动部署

## 用法

- 上面粘贴文字点发送，下面列表 5 秒自动刷新，手机上点复制
- 文件选完点上传（带进度条），手机上点下载
- 长文字自动折叠，可展开；只保留最近 200 条
- 登录一次管 30 天

# Clash AI Probe Web

一个可放进 Docker 的本地网页工具，用来同时测试：

- AI 中转站的真实响应延迟
- OpenClash 对这次请求的命中规则、链路和目标地址

## 本地运行

```bash
node server.mjs
```

打开：

```text
http://localhost:3000
```

## Docker 运行

```bash
cp .env.example .env
```

填写 `.env` 中的 `CLASH_CONTROLLER` 和 `CLASH_SECRET` 后再启动：

```bash
docker compose up -d --build
```

打开：

```text
http://你的NAS地址:3010
```

## 页面里能看到什么

- 响应头延迟
- 首包延迟
- 首 token 延迟
- 总耗时
- 命中的 API 端点
- OpenClash 的 `DIRECT/节点`
- 命中的规则
- `dnsMode`
- 实际远端 IP

## 监控面板能力

- 保存多个 AI 中转站配置
- API Key 保存在 NAS 本地，不会从接口回显给浏览器
- 全局默认检测频率
- 单个中转站覆盖检测频率
- 单站立即检测
- 全部立即检测
- 自动定时检测
- 最近 50 次、1 小时、6 小时、24 小时、7 天历史数据
- 基于成功率和延迟抖动计算 `stable/unstable/down`

数据默认保存在容器内 `/app/data`，Docker Compose 会把它挂载到 `.env` 里的 `DATA_DIR`，默认是项目目录的 `./data`。

## 适合排查的问题

- 中转站本身慢不慢
- 这个域名是否被错误送进代理
- 即使 `DIRECT` 了，是否仍被 `fake-ip/Redir` 影响

## NAS 部署

- 详细步骤见 [DEPLOY_NAS.md](./DEPLOY_NAS.md)
- 如果容器访问不到 `192.168.100.1:9090`，优先检查 NAS 到软路由的网络是否可达
- 如果 OpenClash `secret` 变了，更新 `.env` 或在网页设置里重新填写
- 网页不会主动把服务端保存的 `secret` 回显到浏览器里

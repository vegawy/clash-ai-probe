# NAS 部署说明

这个项目最适合以 Docker Compose 方式部署到 NAS。

## 适用前提

- NAS 已安装 Docker 或 Container Manager
- NAS 能访问外网，用于拉取 `node` 基础镜像
- NAS 能访问你的 Clash/OpenClash 控制器地址，例如 `http://192.168.100.1:9090`
- 你知道 OpenClash 的 `secret`

## 目录准备

把整个项目目录上传到 NAS，例如：

```text
/volume1/docker/clash-ai-probe
```

进入该目录后，先复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env`，至少确认以下几项：

```dotenv
APP_PORT=3010
TZ=Asia/Shanghai
DATA_DIR=./data
CLASH_CONTROLLER=http://192.168.100.1:9090
CLASH_SECRET=你的OpenClashSecret
```

## 启动

在项目目录执行：

```bash
docker compose up -d --build
```

首次启动会自动：

- 构建应用镜像
- 启动 `clash-ai-probe` 容器
- 把运行数据持久化到 `DATA_DIR` 指向的目录

## 访问

浏览器打开：

```text
http://你的NAS地址:3010
```

如果你把 `.env` 里的 `APP_PORT` 改成了别的端口，就用对应端口访问。

## 更新

项目有改动后，在 NAS 项目目录重新执行：

```bash
docker compose up -d --build
```

## 常见问题

### 1. 页面能打开，但检测失败

优先检查：

- NAS 是否能访问 `CLASH_CONTROLLER`
- OpenClash 控制器是否启用了外部访问
- `CLASH_SECRET` 是否填写正确

可以在 NAS 上直接验证：

```bash
curl -H "Authorization: Bearer 你的Secret" http://192.168.100.1:9090/version
```

### 2. 容器启动了，但没有历史数据

确认 `.env` 中的 `DATA_DIR` 映射目录可写。应用会把数据写入：

```text
/app/data
```

宿主机侧就是你配置的 `DATA_DIR`。

### 3. Synology/群晖图形界面部署

如果你不想走 SSH，可以在 Container Manager 中：

1. 新建项目
2. 选择这个项目目录
3. 使用仓库里的 `docker-compose.yml`
4. 在同目录准备好 `.env`
5. 启动项目

### 4. 飞牛 NAS 部署

如果你用的是飞牛或其他 Docker 兼容 NAS，流程相同，关键点只有两个：

- 让 NAS 到 `192.168.100.1:9090` 网络可达
- 把 `CLASH_SECRET` 放在 `.env`，不要再写死到 `docker-compose.yml`

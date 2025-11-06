# 演唱会式选座系统

一个可在局域网部署的演唱会选座系统，前后端同仓，默认使用 FastAPI + SQLite + React。支持 Excel 座位图解析、实时锁座广播、超时释放与购买确认。

## 目录结构

```
backend/    # FastAPI 服务、SQLite 模型、锁管理与解析脚本
frontend/   # Vite + React + TypeScript 前端应用
data/       # Excel 原始数据与生成的 seats.json、SQLite 数据库
tools/dev.py# 同步启动前后端的开发脚本
Makefile    # 常用指令（初始化、开发）
```

## 环境要求

- Python 3.10+
- Node.js 18+
- （可选）Redis 5+（若需使用分布式锁）

## 准备数据

1. 将彩色座位图 Excel 文件命名为 `彩色平面图按舞台.xlsx`，放入 `./data/` 目录。
2. 确保 Excel 中：
   - C9:AN32 为一层座位，行 19/列 L, AE 为空为走廊；
   - C1:AN4 为二层中区，A1:A16 与 AP1:AP16 为禁售侧区；
   - 单元格填充色对应票档（可在 `.env` 覆盖）。

## 快速开始

```bash
# 1. 安装依赖并解析 Excel -> SQLite + seats.json
make init

# 2. 启动后端 (0.0.0.0:8000) 与前端 (0.0.0.0:5173)
make dev
```

启动成功后，在局域网任意设备访问 `http://<主机IP>:5173`。

## 配置

复制 `.env.example` 为 `.env`，可调整：

- `DATABASE_URL`：SQLite/其他数据库连接串
- `SEAT_HOLD_TTL_SECONDS`：锁座 TTL（默认 120 秒）
- `COLOR_TIER_MAP`、`TIER_PRICE_MAP`：票档颜色映射与价格
- `ENABLE_REDIS=true` + `REDIS_URL`：启用 Redis 锁（否则使用 SQLite）

## 主要后端接口

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/seats?floor=1` | 指定楼层座位及状态 |
| POST | `/api/hold` | `{ seat_ids[], client_id }` 锁座，返回 `expire_at` |
| POST | `/api/release` | `{ seat_ids?, client_id }` 释放（默认释放该客户端全部）|
| POST | `/api/confirm` | `{ seat_ids[], client_id, request_id }` 幂等确认购买 |
| GET | `/api/stats` | 座位状态统计与票档营收 |
| WS | `/ws` | 广播 `seat_update` 事件 `{ seat_id, from, to, by, at }` |

## 前端功能

- SVG 座位图渲染（走廊留白）、点击/框选锁座、状态过滤
- 显示已锁座位清单、金额与倒计时
- 实时 WebSocket 同步：他人锁座/释放/购买即时可见
- 锁座冲突与超时自动提示并回滚

## 开发 & 部署提示

- 生产环境可使用 `uvicorn backend.main:app --host 0.0.0.0 --port 8000` 启动后端，再通过任何静态服务托管前端构建产物 (`npm run build`)
- 若启用 Redis，需要在 `.env` 打开 `ENABLE_REDIS` 并提供 `REDIS_URL`
- `backend/parser.py` 可单独运行以重新解析 Excel 与刷新数据

## 验收要点

- 两台设备同时访问，锁座/释放/确认状态实时同步
- 120 秒未确认自动释放并广播
- 禁售区不可点击，已被他人锁定的座位不可再次锁定

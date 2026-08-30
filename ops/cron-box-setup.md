# 常开机器建机器手册（wodify-pull 用）

> 给要把 `api-wodify/` 部署到常开机器上的人看的。前几步涉及注册账号和身份/支付信息，
> 需要用户本人操作；从第 5 步「加固」开始可以叫 Claude 一起做。
>
> 背景见 `DESIGN.md` 第 6.6 节「部署位置」——这台机器只需要装一次、长期跑着，
> 只主动往外发请求（查 Wodify、调 Worker 的 `/api/wod/ingest`），不接收任何入站流量。

---

## 1. 注册甲骨文云

在 [cloud.oracle.com/free](https://cloud.oracle.com/free) 注册 Always Free 账号。

- 需要手机号验证 + 身份信息 + **信用卡/借记卡做身份校验**。Oracle 明确说 Always Free
  不会扣费，但注册流程强制要验证卡，这是最常见的卡点。
- 审核可能需要等待，也有一定概率因为地区/风控被拒——这是真实存在的风险，不是流程细节，
  见 `DESIGN.md` §14「待确认」。

## 2. 选 Home Region

创建账号时会要求选一个 Home Region（区域）。**这个基本选定后不能改**，Always Free 的资源
只在这个区域内提供。建议选一个物理上离你近、从你实际所在地网络访问相对稳定的区域（比如
新加坡、日本、韩国——具体看你人在哪、从哪上网）。

## 3. 建 Compute 实例

登录 OCI Console，创建一个 Compute 实例：

- **Image**：Ubuntu 最新 LTS
- **Shape**：在 shape 列表里筛选 "Always Free eligible"，选
  **`VM.Standard.E2.1.Micro`**（x86，1 OCPU / 1GB 内存）。不要选 Ampere A1（ARM）——
  规格更好但经常没货，创建时要抢，E2.1.Micro 容量稳定，不用跟运气赌
- **SSH 密钥**：创建时会要求提供公钥。本地先生成一对：
  ```bash
  ssh-keygen -t ed25519 -C "wodify-pull-cron-box" -f ~/.ssh/oracle-cronbox
  ```
  把 `~/.ssh/oracle-cronbox.pub` 的内容粘贴到创建界面。**私钥 `~/.ssh/oracle-cronbox`
  不要进任何仓库**
- **网络**：用默认 VCN 的 Public Subnet（这样才有公网 IP 可以 SSH 进去）
- **安全列表（Security List）**：先只放行 22 端口（SSH），入站来源可以先填
  `0.0.0.0/0`（如果你的公网 IP 不固定），后面装完 fail2ban 再考虑收紧到你自己的 IP
- 创建完成后，记下实例的**公网 IP**

## 4. 测试连接

```bash
ssh -i ~/.ssh/oracle-cronbox ubuntu@<公网IP>
```

连上说明基础网络没问题，可以进入下一步。

## 5. 加固（这步之后可以叫 Claude 一起做）

对照 `DESIGN.md` §6.6「常开机器安全加固清单」逐条做：

- 云厂商控制台账号开 2FA（在 Oracle Cloud 账号设置里）
- 系统更新：`sudo apt update && sudo apt upgrade -y`
- 建普通用户，加入 sudo 组，不用 root 跑服务：
  ```bash
  sudo adduser wodify
  sudo usermod -aG sudo wodify
  ```
- SSH 只认密钥，禁密码登录、禁 root 登录：编辑 `/etc/ssh/sshd_config`，确认
  `PasswordAuthentication no`、`PermitRootLogin no`，然后 `sudo systemctl restart sshd`
- 装防火墙，只放行 SSH：
  ```bash
  sudo apt install -y ufw
  sudo ufw allow OpenSSH
  sudo ufw enable
  ```
- 装 fail2ban：
  ```bash
  sudo apt install -y fail2ban
  sudo systemctl enable --now fail2ban
  ```
- 开自动安全更新：
  ```bash
  sudo apt install -y unattended-upgrades
  sudo dpkg-reconfigure --priority=low unattended-upgrades
  ```

## 6. 装运行环境

- Python 3.11+，装 `api-wodify`（`pip install -e .`）
- **不用在这台机器上装 Chrome/登录 Wodify**——见下面「`prime` 在哪里做」

### `prime` 在哪里做

`prime`（抓取会话凭证）需要一个真实登录了 Wodify 的 Chrome。这台云机器没有图形界面，
直接在上面登录意味着还要装一整套桌面环境 + VNC 远程桌面，只为了点几下登录，不划算。

**改成在自己电脑上做**：

1. 本地用日常的 Chrome 正常登录 Wodify
2. 跑 `prime`（对应的 CDP 抓取代码目前还没写，等 `cdp.py` 做完后这里补充具体命令）
3. 把抓到的会话文件（`prime.save_session()` 存的那个 JSON，里面是 cookie/csrf，
   不是密码）**拷贝到云机器上**，路径对应 `config.py` 的 `WODIFY_SESSION_CACHE`
   （默认 `~/.cache/wodify-pull/session.json`），权限记得收紧：
   ```bash
   scp -i ~/.ssh/oracle-cronbox <本地会话文件> ubuntu@<公网IP>:~/.cache/wodify-pull/session.json
   ssh -i ~/.ssh/oracle-cronbox ubuntu@<公网IP> chmod 600 ~/.cache/wodify-pull/session.json
   ```

代价：会话过期需要重新登录时，要重复"本地 prime → 拷贝上去"这个动作，不能远程直接在
服务器上处理。换来的是不用在服务器上装维护一整套桌面环境。如果之后觉得这个手动步骤
太烦，可以再考虑装 Xvfb+VNC 把整个流程搬到服务器上，现在先不做。

## 7. 密钥

这台机器上**只需要一个密钥**：`WODIFY_SYNC_TOKEN`（自己生成一长串随机字符串，跟 Worker
那边 `wrangler secret put WODIFY_SYNC_TOKEN` 设置的值一致）。**不放** `SUPABASE_SERVICE_KEY`
或 `RESEND_API_KEY`——这两个只留在 Cloudflare Worker 上，详见 `DESIGN.md` §6.6「密钥架构」。

`WODIFY_SYNC_TOKEN` 和 Chrome 的用户数据目录（存着 Wodify 登录态）都要收紧权限到只有跑
服务的用户能读：

```bash
chmod 700 <chrome用户数据目录>
chmod 600 <存 WODIFY_SYNC_TOKEN 的文件>
```

## 8. 部署 cron

按 `DESIGN.md` §6.6「调度」表：周一 03:00 跑一次抓整周（一次批量写入，不是拉一天写一天）。
`cli.py` 已经写好，`crontab -e`（跑服务的普通用户下）加一行：

```cron
0 3 * * 1 WODIFY_HOST=<场馆域名> WODIFY_INGEST_URL=https://handoff.irisssaq.workers.dev/api/wod/ingest WODIFY_SYNC_TOKEN=<跟 Worker 那边一致的值> /path/to/venv/bin/python -m wodify.cli week >> ~/wodify-pull.log 2>&1
```

`WODIFY_SESSION_CACHE` 不用显式传，`config.py` 的默认值就是上一步拷贝会话文件的那个路径。
每日校验已经挪到 Worker 的 Cron Trigger 上（见 `api/wrangler.jsonc`），这台机器不用再跑
每日检查这一条。

## 灾难恢复备忘

如果这台机器整个丢了（磁盘损坏、被甲骨文回收等），恢复步骤：

1. 按本文档 1-7 步重新建一台
2. 在本地重新跑一次 `prime`，把会话文件拷贝过去（见第 6 节「`prime` 在哪里做」）
3. `WODIFY_SYNC_TOKEN` 可以沿用旧的（Worker 侧不用跟着换），也可以顺手轮换一个新的

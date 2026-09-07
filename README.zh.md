---
description: "通道专属的沙箱升级通道，面向选择、组合或排查失败关闭的沙箱升级政策的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-escalation-policy

[English](README.md) | 中文

## 概述

`dsh-escalation-policy` 拥有 `ctx.escalation`，即与通用审批在结构上分离的通道专属沙箱升级通道。`ctx.escalation.request(req)` 返回 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`；缺少或失败的应答者一律失败关闭，授权仅适用于所请求的那一种更宽模式。受沙箱强制的工具（bash、pwsh、fs）将严格更宽的重试路由到本通道，而非 `approval/request`，因此升级请求由自身通道判定——绝不通过匹配通用审批的文本。当沙箱升级重试必须与普通审批分开判定、且无应答者时失败关闭时，挂载它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当部署必须把严格更宽的沙箱重试路由到其自身政策通道时，挂载 `dsh-escalation-policy`。该服务与沙箱强制工具组合；工具对更宽的重试调用 `ctx.escalation.request()`，由应答者链或已配置政策决定。

### 请求升级

每个请求必须属于一个打开的 agent turn。服务会追加配对的 `escalation/asked` 与 `escalation/decided` 审计记录，而模型只看到最终记录的工具结果。被中止的请求解析为 `cancelled`；在提交前失败的审计追加会拒绝，而不是返回一条未记录的决定。

应答者是 `escalation/request` 瀑布监听器，与 `approval/request` 的应答者在结构上互不相交。为所属 agent 作答时返回一个结果，否则调用 `next()` 委托。agent 作用域的监听器只接收该 agent 的请求；每个部署应组合一个终态应答者，因为兄弟监听器的顺序并非政策优先级机制。

### 配置政策

`EscalationPolicy` 为 `'ask'`、`'deny'` 或 `'allow'`。生效值取最后一条 `escalation/policy` 事件，缺失时回退到配置；`setEscalationPolicy()` 是写入路径。`escalation` 通用设置命名空间（默认 `config.policy`，否则 `ask`）会在每个全新（非恢复）会话创建时把所选政策钉成一条持久的 `escalation/policy` 事件，因此每个新会话都从当前默认值起步，之后的默认值变更也绝不会改写已建会话。`'deny'` 在交互分发前拒绝，`'allow'` 在交互分发前放行，`'ask'` 则咨询应答者链。三种政策都将其完整当前含义贡献给缓存安全的运行时上下文快照。可选的 `escalation` 会话投影与 `/escalation` 命令仅在投影或命令注册表被组合时激活。

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-escalation-policy)是每个已接受字段的详尽来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本节说明该通道如何把升级与审批分开；可观察行为见[使用本包](#use-this-package)。

### 通道拆分

升级请求绝不走通用审批瀑布：`ctx.escalation.request` 通过 `escalation/request` 瀑布分发，因此严格更宽的重试由升级政策判定，而非通过匹配通用审批的文本。配对的 `escalation/asked` 与 `escalation/decided` 事件保持仅日志性质，因此模型只看到发起消费者自身的结果。

### 政策折叠

生效政策取最后一条 `escalation/policy` 事件，缺失时回退到配置。`escalation` 通用设置命名空间把所选政策钉成每个全新会话创建时的持久事件，因此之后的默认值变更绝不会改写已建会话。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务定义、升级政策折叠、请求分发 |
| [`src/types.ts`](src/types.ts) | 封闭政策、ask id 与结果词汇表 |
| [`src/client.ts`](src/client.ts) | 领域类型的 client 命名空间投影 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴随插件：升级审计流保持一致 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

该通道把升级与通用审批分开；阅读以下页面了解周边审批契约与沙箱设计依据。

- [user-approval](../user-approval/README.zh.md) — 升级在结构上与之分离的通用审批通道。
- [sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.zh.md) — 沙箱升级设计依据。
- [escalation Agent Note](../../../.agents/notes/implemented/architecture/2026-08-22-escalation-channel.zh.md) — 升级通道设计依据。
- [escalation 子系统](../../../docs/subsystems/escalation.zh.md) — 升级子系统页面。

-----

<a id="model-experience"></a>
## 模型体验

### 当前升级政策上下文

#### 模型看到什么

首次请求与每次生效政策切换都会在保留历史之后追加完整的运行时上下文快照。在 `ask` 下，升级贡献说明可能咨询已配置的应答者，缺失时失败关闭。在 `deny` 下，它说明确定性拒绝并告知模型不要请求升级。在 `allow` 下，它说明严格更宽的重试将自动放行。未改变的请求保留较早快照，不追加额外消息。

##### ask 政策贡献

```markdown
Escalation policy: ask. Sandbox escalation retries (sandbox_permissions with a justification) may ask through the configured answerers; without an available answerer the retry fails closed.
```

##### deny 政策贡献

```markdown
Escalation policy: deny. Sandbox escalation retries (sandbox_permissions with a justification) are auto-denied in this session — do not request sandbox escalation (do not set sandbox_permissions).
```

##### allow 政策贡献

```markdown
Escalation policy: allow. A strictly-wider sandbox escalation retry (sandbox_permissions with a justification) is granted automatically in this session without asking the user.
```

#### Token 影响

首次请求与每次生效切换各贡献一条简洁上下文消息；未改变的请求不增加重复的政策 token。

#### KV Cache 影响

在保留历史之后仅追加。`ask`/`deny`/`allow` 切换保留稳定的系统与对话前缀，而不是重写第一条 wire 消息。

### 工具结果

#### 模型看到什么

`escalation/asked` 与 `escalation/decided` 仅作日志。模型只看到发起消费者最终被允许、拒绝、取消或不可用的工具结果；人工权限界面不属于上下文。

#### Token 影响

零重复审计 token。拒绝可能以一段保留的小错误替换普通工具结果，而放行或拒绝返回带有已授权（或维持）模式的普通结果。

#### KV Cache 影响

仅追加；新增可见内容跟随可复用请求前缀，不会使既有 KV cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制定义该通道何时不适合或需要特别小心。它们是当前的包约束，而非任务积压。

- **请求仅在打开的 turn 内有效** — 空闲或两次 turn 之间的调用会在审计前抛出；耐久的 turn 外升级工作流待办。
- **政策与目标模式无关** — 单一 `ask`/`deny`/`allow` 治理所有严格更宽的重试；按目标区分的政策（例如仅拒绝 `danger-full-access`）可在同一通道上自然扩展。
- **`allow` 不持久化授权** — 每次升级均为一次性；没有记忆规则或撤销存储。
- **无内置应答者** — 无头或不完整组合的部署解析为 `unavailable` 并失败关闭；服务本身从不提示人类。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具备权威性。该通道按设计保持与通用审批结构分离；按目标区分的政策与内置应答者仍属后续工作。

</details>

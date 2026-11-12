# 邮件信箱与附件防满仓提取 (`mail_system`)

> 对应源码：`backend/domains/mail_system/`（3 个 `.gd`）。管理单人信箱 100 封上限滚动回收与过期淘汰，并联合 `ItemInstanceFactory` 与 `WearableInventoryAggregate` 提供防背包溢出的安全附件提取管线。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与契约 |
| :--- | :--- | :--- | :--- |
| [mail_item_aggregate.gd](../../../../backend/domains/mail_system/mail_item_aggregate.gd) | `MailItemAggregate` | 邮件实体聚合体 | 声明 `MailStatus`（未读/已读/已领/过期）；提供 `mark_read()`、`has_unclaimed_attachment()` |
| [mailbox_manager.gd](../../../../backend/domains/mail_system/mailbox_manager.gd) | `MailboxManager` | 信箱仓储与容量管理服务 | `receive_mail()`（触及 `mailbox/max_capacity` 自动清理已读无附件旧件）、`get_mail_by_id()`、`get_unread_count()`、`update_expiry()` |
| [mail_delivery_pipeline.gd](../../../../backend/domains/mail_system/mail_delivery_pipeline.gd) | `MailDeliveryPipeline` | 附件安全提取管线 | `claim_single_mail()`、`claim_all_mails()`；核验注册表 `template_id` 并由背包满仓保护兜底（未领附件安全留存于邮件） |

---

## 二、关联配置与验证

- **依赖域**：`inventory`；配置 `domains.mail_system.core`、`narratives.mail_system`。
- **测试入口**：[test_mail_system.gd](../../../../tests/unit/domains/test_mail_system.gd)。

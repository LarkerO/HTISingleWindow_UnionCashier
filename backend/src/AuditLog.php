<?php
declare(strict_types=1);

namespace Cashier;

/**
 * 安全审计日志器
 */
final class AuditLog
{
    public function __construct(private readonly Store $db)
    {
    }

    /**
     * 记录安全事件
     */
    public function log(string $event, array $data): void
    {
        $id = Config::token();
        $record = [
            'id' => $id,
            'event' => $event,
            'timestamp' => time(),
            'ip' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
            'user_agent' => mb_substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
            'data' => $data,
        ];

        try {
            $this->db->put('audit_log', $id, $record);
        } catch (\Throwable $e) {
            error_log("Failed to write audit log: {$e->getMessage()}");
        }
    }

    /**
     * 记录认证事件
     */
    public function authEvent(string $type, ?string $userId, bool $success, ?string $reason = null): void
    {
        $this->log("auth.$type", [
            'user_id' => $userId,
            'success' => $success,
            'reason' => $reason,
        ]);
    }

    /**
     * 记录权限拒绝
     */
    public function accessDenied(string $resource, ?string $userId, string $reason): void
    {
        $this->log('access.denied', [
            'resource' => $resource,
            'user_id' => $userId,
            'reason' => $reason,
        ]);
    }

    /**
     * 记录高风险操作
     */
    public function highRiskOperation(string $operation, string $userId, array $details): void
    {
        $this->log('high_risk.' . $operation, [
            'user_id' => $userId,
            'details' => $details,
        ]);
    }

    /**
     * 记录异常金额操作
     */
    public function suspiciousAmount(string $userId, int $amount, string $context): void
    {
        $this->log('suspicious.amount', [
            'user_id' => $userId,
            'amount' => $amount,
            'context' => $context,
        ]);
    }
}

<?php
declare(strict_types=1);

namespace Cashier;

/**
 * 速率限制器 - 防止暴力攻击和滥用
 * 支持基于IP、用户ID和操作类型的多维度限流
 */
final class RateLimit
{
    private const WINDOW = 60; // 时间窗口（秒）
    
    private array $limits = [
        'login_attempt' => ['max' => 5, 'window' => 300],      // 5次/5分钟
        'api_request' => ['max' => 100, 'window' => 60],       // 100次/分钟
        'websocket_message' => ['max' => 30, 'window' => 60],  // 30次/分钟
        'payment_create' => ['max' => 10, 'window' => 60],     // 10次/分钟
    ];

    public function __construct(private readonly Store $db)
    {
    }

    /**
     * 检查是否超过速率限制
     * @throws Fault 超过限制时抛出
     */
    public function check(string $key, string $action): void
    {
        $limit = $this->limits[$action] ?? null;
        if (!$limit) {
            return;
        }

        $bucketKey = $this->bucketKey($key, $action);
        $bucket = $this->db->get('rate_limit', $bucketKey) ?? ['count' => 0, 'reset' => time()];

        $now = time();
        if ($bucket['reset'] < $now) {
            $bucket = ['count' => 0, 'reset' => $now + $limit['window']];
        }

        if ($bucket['count'] >= $limit['max']) {
            $wait = $bucket['reset'] - $now;
            throw new Fault("操作过于频繁，请等待 {$wait} 秒后重试", 429, 'RATE_LIMIT_EXCEEDED');
        }

        $bucket['count']++;
        $this->db->put('rate_limit', $bucketKey, $bucket);
    }

    /**
     * 清理速率限制记录（用于测试或特殊情况）
     */
    public function reset(string $key, string $action): void
    {
        $this->db->delete('rate_limit', $this->bucketKey($key, $action));
    }

    private function bucketKey(string $key, string $action): string
    {
        return hash('sha256', "$action:$key");
    }

    /**
     * 记录失败的登录尝试
     */
    public function recordLoginFailure(string $identifier): void
    {
        try {
            $this->check($identifier, 'login_attempt');
        } catch (Fault $e) {
            // 记录日志但允许继续，由check方法抛出限制错误
            error_log("Login rate limit exceeded for: $identifier");
            throw $e;
        }
    }
}

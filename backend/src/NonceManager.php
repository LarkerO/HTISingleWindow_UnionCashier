<?php
declare(strict_types=1);

namespace Cashier;

/**
 * Nonce管理器 - 防止API请求重放攻击
 */
final class NonceManager
{
    private const EXPIRY = 300; // Nonce有效期（秒）

    public function __construct(private readonly Store $db)
    {
    }

    /**
     * 验证并存储nonce
     * @throws Fault nonce无效或已使用
     */
    public function verify(string $nonce, string $context): void
    {
        if (!preg_match('/\A[0-9a-f]{32}\z/', $nonce)) {
            throw new Fault('Nonce格式无效', 401, 'INVALID_NONCE');
        }

        $key = hash('sha256', "$context:$nonce");
        $record = $this->db->get('nonce', $key);

        if ($record) {
            throw new Fault('请求重放检测', 401, 'REPLAY_DETECTED');
        }

        // 存储nonce，设置过期时间
        $this->db->put('nonce', $key, ['created' => time(), 'context' => $context]);
    }

    /**
     * 清理过期的nonce记录
     */
    public function cleanup(): void
    {
        $now = time();
        $this->db->write(function () use ($now) {
            foreach ($this->db->list('nonce') as $record) {
                if (($record['created'] ?? 0) < $now - self::EXPIRY) {
                    $key = hash('sha256', $record['context'] . ':' . ($record['nonce'] ?? ''));
                    $this->db->delete('nonce', $key);
                }
            }
        });
    }
}

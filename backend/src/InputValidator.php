<?php
declare(strict_types=1);

namespace Cashier;

/**
 * 增强的输入验证器
 */
final class InputValidator
{
    /**
     * 验证并规范化文本输入
     * 移除零宽字符、RTL覆盖等危险Unicode
     */
    public static function sanitizeText(string $value, int $maxLength = 100): string
    {
        // 移除控制字符
        $value = preg_replace('/[\x00-\x1f\x7f]/', '', $value);
        
        // 移除零宽字符和格式控制符
        $value = preg_replace('/[\x{200B}-\x{200D}\x{FEFF}]/u', '', $value);
        
        // 移除RTL/LTR覆盖标记
        $value = preg_replace('/[\x{202A}-\x{202E}]/u', '', $value);
        
        // Unicode规范化
        if (class_exists('Normalizer')) {
            $value = \Normalizer::normalize($value, \Normalizer::FORM_C) ?: $value;
        }
        
        // 限制长度
        if (mb_strlen($value) > $maxLength) {
            throw new Fault("文本长度不能超过 {$maxLength} 字符");
        }
        
        if ($value === '') {
            throw new Fault('文本不能为空');
        }
        
        return $value;
    }

    /**
     * 验证图片文件
     * 使用魔数二次验证
     */
    public static function validateImage(string $bytes, array $allowedTypes = ['image/jpeg', 'image/png', 'image/webp']): array
    {
        $info = @getimagesizefromstring($bytes);
        if (!$info || !in_array($info['mime'], $allowedTypes, true)) {
            throw new Fault('图片格式无效');
        }

        // 魔数验证
        $magic = bin2hex(substr($bytes, 0, 12));
        $valid = false;
        
        switch ($info['mime']) {
            case 'image/jpeg':
                $valid = str_starts_with($magic, 'ffd8ff');
                break;
            case 'image/png':
                $valid = str_starts_with($magic, '89504e470d0a1a0a');
                break;
            case 'image/webp':
                $valid = str_starts_with($magic, '52494646') && substr($magic, 16, 8) === '57454250';
                break;
        }

        if (!$valid) {
            throw new Fault('图片文件头验证失败');
        }

        if ($info[0] > 2400 || $info[1] > 2400 || $info[0] * $info[1] > 4000000) {
            throw new Fault('图片尺寸超过限制');
        }

        return $info;
    }

    /**
     * 验证金额是否异常
     */
    public static function checkSuspiciousAmount(int $amount, string $context = ''): void
    {
        // 单笔超过100万需要额外关注
        if ($amount > 1_000_000) {
            error_log("Suspicious high amount detected: $amount in context: $context");
        }
    }
}

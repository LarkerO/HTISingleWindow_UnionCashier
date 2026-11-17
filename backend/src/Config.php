<?php
declare(strict_types=1);

namespace Cashier;

final class Config
{
    public static function read(): ?array
    {
        $path = self::path();
        return is_file($path) ? self::decode((string) file_get_contents($path)) : null;
    }

    public static function runtime(string $file = ''): string
    {
        $directory = getenv('CASHIER_RUNTIME_DIR') ?: BASE_PATH . '/runtime';
        return $file === '' ? $directory : $directory . '/' . $file;
    }

    public static function path(): string
    {
        clearstatcache(true, self::runtime('install.json'));
        return self::runtime('install.json');
    }

    public static function save(array $config): void
    {
        $path = self::path();
        $tmp = $path . '.' . bin2hex(random_bytes(8));
        $previous = umask(0077);
        try {
            if (file_put_contents($tmp, self::json($config), LOCK_EX) === false || !rename($tmp, $path)) {
                throw new \RuntimeException('Cannot persist installation');
            }
        } finally {
            umask($previous);
            if (is_file($tmp)) {
                unlink($tmp);
            }
        }
    }

    public static function json(array $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    public static function decode(string $value): array
    {
        $data = json_decode($value, true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($data)) {
            throw new Fault('需要 JSON 对象');
        }
        return $data;
    }

    public static function token(): string
    {
        return bin2hex(random_bytes(16));
    }

    public static function url(string $value, bool $originOnly = false): string
    {
        $parts = parse_url($value);
        if (!filter_var($value, FILTER_VALIDATE_URL) || !$parts
            || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])
            || preg_match('/[\\\\\x00-\x20\x7f]/', $value)
            || ($originOnly && (isset($parts['query']) || !in_array($parts['path'] ?? '', ['', '/'], true)))) {
            throw new Fault('请输入有效的 HTTP(S) 地址');
        }
        return $originOnly ? rtrim($value, '/') : $value;
    }

    public static function origin(string $url): string
    {
        $p = parse_url(self::url($url));
        return strtolower($p['scheme'] . '://' . $p['host']) . (isset($p['port']) ? ':' . $p['port'] : '');
    }
}

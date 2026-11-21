<?php
declare(strict_types=1);

namespace Cashier;

use Predis\Client;
use Workerman\Protocols\Http\Session;
use Workerman\Protocols\Http\Session\FileSessionHandler;

final class Sessions extends FileSessionHandler
{
    public static function configure(): void
    {
        // 配置安全的Session Cookie参数
        Session::$cookieParams = [
            'lifetime' => 7200,           // 2小时
            'path' => '/',
            'domain' => '',
            'secure' => true,             // HTTPS only
            'httponly' => true,           // 防止XSS
            'samesite' => 'Lax',          // 防止CSRF
        ];
    }

    public static function redis(string $uri): Client
    {
        if (!preg_match('/\A(?:redis|rediss|tcp|tls):\/\//', $uri)) {
            throw new Fault('Redis 必须使用 redis:// 或 rediss://');
        }
        $uri = preg_replace(['/^redis:/', '/^rediss:/'], ['tcp:', 'tls:'], $uri);
        return new Client($uri . (str_contains($uri, '?') ? '&' : '?') . 'timeout=2&read_write_timeout=3');
    }

    private function storage(string $id): array
    {
        $config = Config::read();
        $uri = $config['redis'] ?? '';
        return [$uri === '' ? null : self::redis($uri), 'htisw:' . ($config['instance'] ?? '') . ':session:' . $id];
    }

    public function read(string $sessionId): string|false
    {
        [$redis, $key] = $this->storage($sessionId);
        return $redis ? ($redis->get($key) ?? false) : parent::read($sessionId);
    }

    public function write(string $sessionId, string $sessionData): bool
    {
        [$redis, $key] = $this->storage($sessionId);
        return $redis ? (string) $redis->setex($key, Session::$lifetime, $sessionData) === 'OK'
            : parent::write($sessionId, $sessionData);
    }

    public function destroy(string $sessionId): bool
    {
        [$redis, $key] = $this->storage($sessionId);
        if ($redis) {
            $redis->del([$key]);
        }
        return parent::destroy($sessionId);
    }

    public function updateTimestamp(string $sessionId, string $data = ''): bool
    {
        [$redis, $key] = $this->storage($sessionId);
        return $redis ? $redis->expire($key, Session::$lifetime) === 1 : parent::updateTimestamp($sessionId, $data);
    }
}

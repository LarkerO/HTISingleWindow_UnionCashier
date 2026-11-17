<?php
declare(strict_types=1);

namespace Cashier;

final class Portal
{
    public static function authorize(array $config, string $state, string $verifier): string
    {
        return $config['portal'] . '/oauth/authorize?' . http_build_query([
            'response_type' => 'code', 'client_id' => $config['client_id'],
            'redirect_uri' => $config['origin'] . '/oauth/callback', 'scope' => 'profile',
            'state' => $state, 'code_challenge_method' => 'S256',
            'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '='),
        ], '', '&', PHP_QUERY_RFC3986);
    }

    public static function profile(array $config, string $code, string $verifier): array
    {
        $token = self::request('换取访问令牌', $config['portal'] . '/api/oauth/token', [], [
            'grant_type' => 'authorization_code', 'code' => $code, 'code_verifier' => $verifier,
            'redirect_uri' => $config['origin'] . '/oauth/callback', 'client_id' => $config['client_id'],
            'client_secret' => $config['client_secret'],
        ])['access_token'] ?? '';
        if (!is_string($token) || !preg_match('/\A[\x21-\x7e]{1,4096}\z/', $token)) {
            throw new Fault('Portal 登录测试失败：未收到访问令牌', 502);
        }
        $profile = self::request('读取用户资料', $config['portal'] . '/api/oauth/userinfo', ['Authorization: Bearer ' . $token]);
        $sub = $profile['sub'] ?? null;
        if (!is_string($sub) || !preg_match('/\A[A-Za-z0-9_-]{1,100}\z/', $sub)) {
            throw new Fault('Portal 登录测试失败：身份标识无效', 502);
        }
        $user = [
            'id' => $sub, 'hydroline_id' => mb_substr((string) ($profile['hydroline_id'] ?? ''), 0, 100),
            'name' => mb_substr((string) ($profile['name'] ?? $profile['preferred_username'] ?? $sub), 0, 120),
        ];
        $username = $profile['preferred_username'] ?? null;
        if (is_string($username) && $username !== '') {
            $accounts = self::request('读取 Minecraft 档案', $config['portal'] . '/api/public/users/' .
                rawurlencode($username) . '/minecraft-accounts', [], null, true)['accounts'] ?? [];
            $eligible = array_values(array_filter($accounts, static fn ($account) =>
                is_array($account) && ($account['identityKind'] ?? '') === 'AUTHENTICATED'
                && ($account['status'] ?? '') === 'VERIFIED'
                && is_string($account['uuid'] ?? null)
                && preg_match('/\A[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}\z/i', $account['uuid'])));
            $primary = array_values(array_filter($eligible, static fn ($account) => ($account['isPrimary'] ?? false) === true));
            $selected = count($primary) === 1 ? $primary[0] : (count($eligible) === 1 ? $eligible[0] : null);
            if ($selected) {
                $user += ['uuid' => strtolower($selected['uuid']), 'minecraft_name' => mb_substr((string) $selected['username'], 0, 50)];
            }
        }
        return $user;
    }

    public static function saveProfile(Store $db, array $user, bool $admin = false): void
    {
        $existing = $db->get('user', $user['id']) ?? [];
        if (isset($existing['uuid']) && ($db->get('uuid', $existing['uuid'])['user'] ?? '') === $user['id']) {
            $db->delete('uuid', $existing['uuid']);
        }
        if (isset($existing['link_code'])) {
            $db->delete('link', $existing['link_code']);
        }
        if (($existing['uuid'] ?? '') !== ($user['uuid'] ?? '')) {
            $db->delete('balance', $user['id']);
        }
        unset($existing['uuid'], $existing['minecraft_name'], $existing['minecraft_source'], $existing['link_code']);
        if (isset($user['uuid'])) {
            $owner = $db->get('uuid', $user['uuid'])['user'] ?? null;
            if ($owner !== null && $owner !== $user['id']) {
                $claimed = $db->get('user', $owner);
                if (!$claimed || ($claimed['minecraft_source'] ?? '') !== 'portal') {
                    if ($claimed && ($claimed['uuid'] ?? '') === $user['uuid']) {
                        unset($claimed['uuid'], $claimed['minecraft_name']);
                        $db->put('user', $owner, $claimed);
                        $db->delete('balance', $owner);
                    }
                    $owner = null;
                }
            }
            if ($owner !== null && $owner !== $user['id']) {
                unset($user['uuid'], $user['minecraft_name']);
            } else {
                $user['minecraft_source'] = 'portal';
                $db->put('uuid', $user['uuid'], ['user' => $user['id']]);
            }
        }
        $db->put('user', $user['id'], $user + ['admin' => $admin || ($existing['admin'] ?? false)] + $existing);
    }

    private static function request(string $stage, string $url, array $headers, ?array $form = null, bool $allowMissing = false): array
    {
        $curl = curl_init($url);
        $options = [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HTTPHEADER => ['Accept: application/json', ...$headers],
        ];
        // Windows PHP builds backed by OpenSSL may lack a default CA bundle.
        if (DIRECTORY_SEPARATOR === '\\' && defined('CURLSSLOPT_NATIVE_CA') && !ini_get('curl.cainfo')) {
            $options[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;
        }
        if (defined('CURLOPT_PROTOCOLS_STR')) {
            $options[CURLOPT_PROTOCOLS_STR] = 'http,https';
        } else {
            $options[CURLOPT_PROTOCOLS] = CURLPROTO_HTTP | CURLPROTO_HTTPS;
        }
        if ($form !== null) {
            $options += [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($form)];
        }
        curl_setopt_array($curl, $options);
        $body = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $errno = curl_errno($curl);
        if ($allowMissing && $status === 404) {
            return [];
        }
        if ($body === false || $status === 0) {
            $detail = match ($errno) {
                5, 6 => '域名解析失败',
                7 => '连接失败',
                28 => '连接或请求超时',
                35, 60, 77 => 'TLS 连接或证书校验失败，请检查 PHP 的 CA 证书配置',
                default => '未收到 HTTP 响应',
            };
            throw new Fault("HydCraft Portal {$stage}失败：{$detail}（cURL {$errno}）", 502);
        }
        if ($status !== 200 || strlen($body) > 65536) {
            throw new Fault("HydCraft Portal {$stage}失败（HTTP {$status}）", 502);
        }
        try {
            return Config::decode($body);
        } catch (\JsonException | Fault) {
            throw new Fault("HydCraft Portal {$stage}失败：响应格式无效", 502);
        }
    }
}

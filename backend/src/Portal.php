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
        $token = self::request($config['portal'] . '/api/oauth/token', [], [
            'grant_type' => 'authorization_code', 'code' => $code, 'code_verifier' => $verifier,
            'redirect_uri' => $config['origin'] . '/oauth/callback', 'client_id' => $config['client_id'],
            'client_secret' => $config['client_secret'],
        ])['access_token'] ?? '';
        if (!is_string($token) || !preg_match('/\A[\x21-\x7e]{1,4096}\z/', $token)) {
            throw new Fault('Portal 登录测试失败：未收到访问令牌', 502);
        }
        $profile = self::request($config['portal'] . '/api/oauth/userinfo', ['Authorization: Bearer ' . $token]);
        $sub = $profile['sub'] ?? null;
        if (!is_string($sub) || !preg_match('/\A[A-Za-z0-9_-]{1,100}\z/', $sub)) {
            throw new Fault('Portal 登录测试失败：身份标识无效', 502);
        }
        return [
            'id' => $sub, 'hydroline_id' => mb_substr((string) ($profile['hydroline_id'] ?? ''), 0, 100),
            'name' => mb_substr((string) ($profile['name'] ?? $profile['preferred_username'] ?? $sub), 0, 120),
        ];
    }

    private static function request(string $url, array $headers, ?array $form = null): array
    {
        $curl = curl_init($url);
        $options = [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HTTPHEADER => ['Accept: application/json', ...$headers],
        ];
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
        unset($curl);
        if (!is_string($body) || $status !== 200 || strlen($body) > 65536) {
            throw new Fault('HydCraft Portal 请求失败（HTTP ' . $status . '）', 502);
        }
        return Config::decode($body);
    }
}

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
            'avatar_url' => self::avatarUrl($config['portal'], $profile['picture'] ?? null),
        ];
        $username = $profile['preferred_username'] ?? null;
        if (!is_string($username) || $username === '') {
            return $user + ['minecraft_status' => 'profile_scope_missing'];
        }
        $profileUrl = $config['portal'] . '/api/public/users/' . rawurlencode($username);
        if ($user['avatar_url'] === null) {
            $user['avatar_url'] = self::publicAvatar($config['portal'], $profileUrl);
        }
        $profile = self::request('读取 Minecraft 档案', $profileUrl . '/minecraft-accounts', [], null, 2097152, true);
        if (isset($profile['not_found'])) {
            return $user + ['minecraft_status' => 'profile_unavailable'];
        }
        if (!is_array($profile['accounts'] ?? null) || !array_is_list($profile['accounts'])) {
            throw new Fault('HydCraft Portal Minecraft 档案响应缺少账号列表', 502);
        }
        return $user + self::minecraftProfile($profile['accounts']);
    }

    private static function publicAvatar(string $portal, string $profileUrl): ?string
    {
        try {
            $public = self::request('读取公开头像', $profileUrl, [], null, 2097152, true);
            return self::avatarUrl($portal, $public['profile']['avatarUrl'] ?? null);
        } catch (Fault) {
            // An optional public avatar must not prevent OAuth login.
            return null;
        }
    }

    private static function avatarUrl(string $portal, mixed $picture): ?string
    {
        if (!is_string($picture) || strlen($picture) > 2048) {
            return null;
        }
        $picture = trim($picture);
        if (str_starts_with($picture, '/') && !str_starts_with($picture, '//')) {
            $picture = Config::origin($portal) . $picture;
        }
        try {
            $url = Config::url($picture);
            return str_starts_with($url, 'https://') || Config::origin($url) === Config::origin($portal) ? $url : null;
        } catch (Fault) {
            return null;
        }
    }

    private static function minecraftProfile(array $accounts): array
    {
        $verified = array_values(array_filter($accounts, static fn ($account) =>
            is_array($account) && ($account['identityKind'] ?? '') === 'AUTHENTICATED'
            && ($account['status'] ?? '') === 'VERIFIED'));
        if (!$verified) {
            return ['minecraft_status' => 'unverified'];
        }
        $primary = array_values(array_filter($verified, static fn ($account) => ($account['isPrimary'] ?? false) === true));
        $selected = count($primary) === 1 ? $primary[0] : (count($verified) === 1 ? $verified[0] : null);
        if ($selected === null) {
            return ['minecraft_status' => 'primary_required'];
        }

        // Portal can verify an AuthMe binding before recording its bound UUID.
        // playerIdentity.resolvedUuid may come from a match by username alone.
        $uuid = $selected['uuid'] ?? $selected['playerIdentity']['boundUuid'] ?? null;
        if (!is_string($uuid) || !preg_match('/\A(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\z/i', $uuid)) {
            return ['minecraft_status' => 'uuid_missing', 'minecraft_name' => mb_substr((string) ($selected['username'] ?? ''), 0, 50)];
        }
        $compact = strtolower(str_replace('-', '', $uuid));
        $uuid = vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split($compact, 4));
        return ['minecraft_status' => 'linked', 'uuid' => $uuid,
            'minecraft_name' => mb_substr((string) ($selected['username'] ?? ''), 0, 50)];
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
                unset($user['uuid']);
                $user['minecraft_status'] = 'uuid_in_use';
            } else {
                $user['minecraft_source'] = 'portal';
                $db->put('uuid', $user['uuid'], ['user' => $user['id']]);
            }
        }
        $db->put('user', $user['id'], $user + ['admin' => $admin || ($existing['admin'] ?? false)] + $existing);
    }

    private static function request(string $stage, string $url, array $headers, ?array $form = null, int $maxBytes = 65536, bool $allowMissing = false): array
    {
        $curl = curl_init($url);
        $body = '';
        $tooLarge = false;
        $options = [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body, &$tooLarge, $maxBytes): int {
                if (strlen($body) + strlen($chunk) > $maxBytes) {
                    $tooLarge = true;
                    return 0;
                }
                $body .= $chunk;
                return strlen($chunk);
            },
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
        $success = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $errno = curl_errno($curl);
        if ($allowMissing && $status === 404) {
            return ['not_found' => true];
        }
        if ($tooLarge) {
            throw new Fault("HydCraft Portal {$stage}失败：响应超过允许大小", 502);
        }
        if ($success === false || $status === 0) {
            $detail = match ($errno) {
                5, 6 => '域名解析失败',
                7 => '连接失败',
                28 => '连接或请求超时',
                35, 60, 77 => 'TLS 连接或证书校验失败，请检查 PHP 的 CA 证书配置',
                default => '未收到 HTTP 响应',
            };
            throw new Fault("HydCraft Portal {$stage}失败：{$detail}（cURL {$errno}）", 502);
        }
        if ($status !== 200) {
            throw new Fault("HydCraft Portal {$stage}失败（HTTP {$status}）", 502);
        }
        try {
            return Config::decode($body);
        } catch (\JsonException | Fault) {
            throw new Fault("HydCraft Portal {$stage}失败：响应格式无效", 502);
        }
    }
}

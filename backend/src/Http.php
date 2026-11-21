<?php
declare(strict_types=1);

namespace Cashier;

use support\Request;
use support\Response;
use Workerman\Protocols\Http\Session;

final class Http
{
    private const INSTALL_RESULT = '/install?step=verify';
    private const HEADERS = [
        'Cache-Control' => 'no-store',
        'X-Content-Type-Options' => 'nosniff',
        'Referrer-Policy' => 'no-referrer',
        'X-Frame-Options' => 'DENY',
    ];

    public function page(Request $request, string $id = ''): Response
    {
        if ($id !== '' && $request->get('desktop') !== '1'
            && preg_match('/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i', $request->header('user-agent', ''))) {
            return $this->redirect('/mobile/checkout/' . $id);
        }
        $portal = Config::read()['portal'] ?? null;
        return $this->html('index.html', $portal === null ? '' : ' https: ' . Config::origin($portal));
    }

    public function mobile(Request $request, string $id = ''): Response
    {
        $portal = Config::read()['portal'] ?? null;
        return $this->html('mobile/index.html', $portal === null ? '' : ' https: ' . Config::origin($portal));
    }

    public function documentation(Request $request, string $operation = ''): Response
    {
        return $this->html('docs.html');
    }

    private function html(string $entry, string $avatarOrigins = ''): Response
    {
        $file = BASE_PATH . '/public/' . $entry;
        if (!is_file($file)) {
            $project = str_starts_with($entry, 'mobile/') ? 'mobile' : 'frontend';
            return new Response(503, self::HEADERS, '请先进入 ' . $project . '，运行 pnpm install --frozen-lockfile 和 pnpm build');
        }
        return (new Response(200, self::HEADERS + ['Content-Type' => 'text/html; charset=utf-8',
            'Content-Security-Policy' => "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; img-src 'self' data:{$avatarOrigins}"]))->withFile($file);
    }

    public function api(Request $request, string $path): Response
    {
        return $this->attempt(function () use ($request, $path) {
            $method = $request->method();
            $config = Config::read();
            if ($method === 'GET' && $path === 'platform-key') {
                return $this->json(['public_key' => $config['keys']['public'] ?? null]);
            }
            $session = $this->session($request, $config);
            if ($method === 'GET' && $path === 'status') {
                $csrf = $session->get('csrf') ?: Config::token();
                $session->set('csrf', $csrf);
                $user = null;
                $online = false;
                if ($config) {
                    $db = new Store($config);
                    $online = ($db->get('system', 'bridge')['time'] ?? 0) >= time() - 12;
                    $id = $session->get('user');
                    $user = $id ? $db->get('user', $id) : null;
                }
                return $this->json([
                    'installed' => (bool) $config, 'csrf' => $csrf, 'user' => $this->publicUser($user),
                    'mode' => $config['mode'] ?? null, 'plugin_online' => $online,
                    'public_key' => $config['keys']['public'] ?? null,
                    'oauth_error' => $session->get('oauth_error'),
                    'oauth_setup_verified' => $session->get('oauth_setup_verified', false),
                    'oauth_setup_retry' => !$config && ($session->get('oauth_setup')['expires'] ?? 0) >= time(),
                ]);
            }
            if ($method === 'POST') {
                $this->csrf($request, $session);
                $body = $this->body($request, $path === 'card-art' ? 625000 : 131072);
            } elseif ($method !== 'GET') {
                throw new Fault('不支持该请求方法', 405);
            }
            if (!$config) {
                if ($method === 'POST' && $path === 'install') {
                    return $this->install($session, $body);
                }
                throw new Fault('请先完成安装', 503);
            }
            $db = new Store($config);
            $clearing = new Clearing($db, $config);
            $id = $session->get('user');
            if ($method === 'GET' && preg_match('~^card-art/([0-9a-f]{32})$~D', $path, $match)) {
                $image = $db->get('card_image', $match[1]) ?? throw new Fault('卡面不存在', 404);
                return (new Response(200, [
                    'Content-Type' => $image['mime'], 'X-Content-Type-Options' => 'nosniff',
                    'Cache-Control' => 'public, max-age=86400',
                ]))->withFile($clearing->cards->imagePath($match[1]));
            }
            if (!$id) {
                throw new Fault('请通过 HydCraft Portal 登录', 401);
            }
            $user = $clearing->user($id);

            if ($method === 'GET') {
                if ($path === 'player-wallet') {
                    return $this->json((new Wallet($db, $clearing))->snapshot($user, (string) $request->get('environment', 'live')));
                }
                if ($path === 'cards') {
                    return $this->json($clearing->cards->account($id) + ['catalog' => $clearing->cards->catalog()]);
                }
                if ($path === 'card-types') {
                    return $this->json($clearing->cards->issuance($user, (string) $request->get('issuer', '')));
                }
                if ($path === 'payment-order') {
                    return $this->json($clearing->paymentOrder($id));
                }
                if ($path === 'payment-limits') {
                    return $this->json(['limits' => $db->list('payment_limit', $id)]);
                }
                if ($path === 'statement' || $path === 'statement.xlsx') {
                    $filter = $request->get();
                    $merchantId = (string) ($filter['merchant'] ?? '');
                    $merchantView = ($filter['scope'] ?? '') === 'merchant';
                    if ($merchantView) {
                        $clearing->manage($user, $merchantId);
                    }
                    $rows = $clearing->statements->read($merchantView ? null : $id, $merchantId, $filter, $path === 'statement.xlsx');
                    if ($path === 'statement') {
                        return $this->json($rows);
                    }
                    return new Response(200, self::HEADERS + [
                        'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'Content-Disposition' => 'attachment; filename="statement.xlsx"',
                    ], Statements::xlsx($rows));
                }
                if ($path === 'account') {
                    $orders = array_map(fn ($row) => $this->playerView($clearing->order($row['id'])), $db->list('player_order', $id));
                    usort($orders, static fn (array $a, array $b) => $b['created'] <=> $a['created']);
                    return $this->json(['orders' => $orders, 'balance' => $this->balanceView($db->get('balance', $id))]);
                }
                if ($path === 'merchants') {
                    $merchants = array_values(array_filter($db->list('merchant'),
                        static fn (array $m) => $user['admin'] || isset($m['members'][$id])));
                    return $this->json(['merchants' => $merchants]);
                }
                if ($path === 'admin') {
                    $this->admin($user);
                    return $this->json(['plugin_set' => !empty($config['plugin_public']), 'reviews' => $db->list('review')]);
                }
                if ($path === 'minecraft-binding') {
                    $this->admin($user);
                    return $this->json((new MinecraftBindings($db))->inspect($user,
                        Clearing::text($request->get(), 'user')));
                }
                if (preg_match('~^checkout/([0-9a-f]{32})$~D', $path, $match)) {
                    $order = $clearing->playerOrder($user, $match[1]);
                    return $this->json(['order' => $this->playerView($order),
                        'cards' => $order['status'] === 'pending' ? $clearing->paymentCards($user, $order) : [],
                        'payment_order' => $order['status'] === 'pending' ? $clearing->paymentOrder($id)['methods'] : []]);
                }
                if (preg_match('~^merchants/([0-9a-f]{32})$~D', $path, $match)) {
                    $merchant = $clearing->manage($user, $match[1]);
                    $orders = $db->list('order', $merchant['id']);
                    usort($orders, static fn (array $a, array $b) => $b['created'] <=> $a['created']);
                    return $this->json(['merchant' => $merchant, 'orders' => $orders,
                        'balances' => array_map(fn ($row) => $row + ['available' => $clearing->available($merchant['id'], $row)], $db->list('ledger', $merchant['id']))]);
                }
                throw new Fault('接口不存在', 404);
            }

            switch ($path) {
                case 'logout':
                    $session->flush();
                    $request->sessionRegenerateId(true);
                    return $this->json(['ok' => true]);
                case 'cards':
                    $action = Clearing::text($body, 'action');
                    return $this->json(match ($action) {
                        'save' => $clearing->cards->type($user, $body),
                        'buy' => $clearing->cards->buy($user, $body),
                        'redeem' => $db->write(fn () => $clearing->cards->redeem($id, $body)),
                        'bind' => $db->write(function () use ($clearing, $user, $body) {
                            $issuer = (string) ($body['issuer'] ?? '');
                            if ($issuer !== '') {
                                $clearing->manage($user, $issuer, true);
                            } else {
                                $this->admin($user);
                            }
                            return $clearing->cards->redeem(Clearing::text($body, 'user'), $body, $issuer);
                        }),
                        'transfer' => $clearing->cards->transfer($user, $body),
                        'return' => $clearing->cards->close($user, $body),
                        'fund' => $clearing->cards->fund($user, $body),
                        default => throw new Fault('未知卡片操作', 404),
                    });
                case 'card-art':
                    return $this->json(['id' => $clearing->cards->addImage($id, $body)]);
                case 'payment-order':
                    return $this->json($clearing->savePaymentOrder($id, $body['methods'] ?? null));
                case 'payment-limits':
                    return $this->json($clearing->limits->save($id, $body));
                case 'balance':
                    return $this->json($this->balanceView($clearing->balance($user)));
                case 'checkout':
                    $action = Clearing::text($body, 'action');
                    if (!in_array($action, ['confirm', 'revoke'], true) || !is_array($body['methods'] ?? [])) {
                        throw new Fault('无效操作');
                    }
                    $order = $clearing->playerAction($user, Clearing::text($body, 'id'), $action, $body['methods'] ?? []);
                    return $this->json(['order' => $this->playerView($order)]);
                case 'merchant':
                    $action = Clearing::text($body, 'action');
                    if ($action === 'command') {
                        $input = $body['input'] ?? null;
                        if (!is_array($input)) {
                            throw new Fault('需要命令参数');
                        }
                        $merchant = $clearing->manage($user, Clearing::text($body, 'merchant'), ($input['action'] ?? '') === 'payout');
                        return $this->json($clearing->command($merchant, Clearing::text($body, 'environment'), $input, true));
                    }
                    return $this->json(['merchant' => $clearing->merchantSettings($user, $action, $body)]);
                case 'plugin':
                    $this->admin($user);
                    $this->configurePlugin((string) ($body['public_key'] ?? ''));
                    return $this->json(['ok' => true]);
                case 'minecraft-binding':
                    $this->admin($user);
                    return $this->json((new MinecraftBindings($db))->change($user, $body));
                case 'review':
                    $this->admin($user);
                    if (!is_bool($body['applied'] ?? null)) {
                        throw new Fault('请选择资金操作是否已执行');
                    }
                    $clearing->resolveReview(Clearing::text($body, 'id'), $body['applied']);
                    return $this->json(['ok' => true]);
                default:
                    throw new Fault('接口不存在', 404);
            }
        });
    }

    private function install(Session $session, array $body): Response
    {
        $path = Config::runtime('setup.hash');
        $stored = is_file($path) ? trim((string) file_get_contents($path)) : '';
        $input = Clearing::text($body, 'token');
        if (!$stored || !hash_equals($stored, openssl_digest($input, 'sm3'))) {
            throw new Fault('安装口令错误，请先在服务器运行 php start.php setup-token', 403);
        }
        $driver = Clearing::text($body, 'driver');
        $config = [
            'driver' => $driver, 'portal' => Config::url(Clearing::text($body, 'portal', 240), true),
            'origin' => Config::url(Clearing::text($body, 'origin', 240), true),
            'client_id' => Clearing::text($body, 'client_id', 240),
            'client_secret' => Clearing::text($body, 'client_secret', 512),
            'redis' => trim((string) ($body['redis'] ?? '')), 'openssl' => $this->opensslCommand(),
            'instance' => Config::token(), 'mode' => $body['mode'] ?? 'development',
        ];
        if (!in_array($config['mode'], ['development', 'production'], true)) {
            throw new Fault('无效部署环境');
        }
        if ($config['mode'] === 'production'
            && (!str_starts_with($config['portal'], 'https://') || !str_starts_with($config['origin'], 'https://'))) {
            throw new Fault('正式环境的 Portal 和清算站点地址必须使用 HTTPS');
        }
        if ($driver === 'sqlite') {
            $config['dsn'] = 'sqlite:' . Config::runtime('cashier.sqlite3');
        } elseif (in_array($driver, ['mysql', 'pgsql'], true)) {
            $host = Clearing::text($body, 'db_host');
            $name = Clearing::text($body, 'db_name');
            $port = filter_var($body['db_port'] ?? '', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 65535]]);
            if (!preg_match('/\A[A-Za-z0-9.:-]+\z/', $host) || !preg_match('/\A[A-Za-z0-9_-]+\z/', $name) || !$port) {
                throw new Fault('数据库主机、端口或名称无效');
            }
            $config['dsn'] = "$driver:host=$host;port=$port;dbname=$name" . ($driver === 'mysql' ? ';charset=utf8mb4' : '');
            $config['db_user'] = Clearing::text($body, 'db_user');
            $config['db_password'] = (string) ($body['db_password'] ?? '');
        } else {
            throw new Fault('不支持的数据库');
        }
        try {
            new Store($config);
            if ($config['redis'] !== '' && (string) Sessions::redis($config['redis'])->ping() !== 'PONG') {
                throw new \RuntimeException('Redis ping failed');
            }
        } catch (\Throwable) {
            throw new Fault('无法连接配置的数据库或 Redis，请核对参数');
        }
        $config['setup_hash'] = $stored;
        $session->set('oauth_setup', ['config' => $config, 'expires' => time() + 600]);
        $url = $this->beginOAuth($session, $config, '/', true);
        return $this->json(['authorize_url' => $url]);
    }

    public function login(Request $request): Response
    {
        return $this->attempt(function () use ($request) {
            $config = Config::read();
            $session = $this->session($request, $config);
            if (!$config) {
                $setup = $session->get('oauth_setup');
                if (($setup['expires'] ?? 0) < time()) {
                    return $this->redirect('/install');
                }
                return $this->redirect($this->beginOAuth($session, $setup['config'], '/', true));
            }
            $next = $request->get('next', '/');
            if (!is_string($next) || !preg_match('~\A/(?:checkout/[a-f0-9]{32}|mobile/(?:checkout/[a-f0-9]{32})?)?\z~', $next)) {
                $next = '/';
            }
            return $this->redirect($this->beginOAuth($session, $config, $next, false));
        });
    }

    private function beginOAuth(Session $session, array $config, string $next, bool $setup): string
    {
        $state = Config::token();
        $verifier = bin2hex(random_bytes(32));
        $session->forget(['oauth_error', 'oauth_setup_verified']);
        $session->set('oauth', ['state' => $state, 'verifier' => $verifier, 'next' => $next,
            'expires' => time() + 600, 'config' => $setup ? $config : null]);
        return Portal::authorize($config, $state, $verifier);
    }

    public function callback(Request $request): Response
    {
        return $this->attempt(function () use ($request) {
            $current = Config::read();
            $session = $this->session($request, $current);
            $oauth = $session->pull('oauth');
            $next = $current ? '/' : self::INSTALL_RESULT;
            try {
                $state = $request->get('state');
                if (!$oauth || $oauth['expires'] < time() || !is_string($state) || !hash_equals($oauth['state'], $state)) {
                    throw new Fault('Portal 登录状态无效，请重新登录', 401);
                }
                $next = $oauth['config'] ? self::INSTALL_RESULT : $oauth['next'];
                $config = $oauth['config'] ?? $current;
                $code = $request->get('code');
                if (!$config || !is_string($code) || $code === '' || strlen($code) > 4096) {
                    throw new Fault('Portal 登录授权未完成', 401);
                }
                $user = Portal::profile($config, $code, $oauth['verifier']);
                if ($oauth['config']) {
                    $session->set('oauth_setup_verified', true);
                    $this->finishInstall($config, $user);
                } else {
                    $db = new Store($config);
                    $db->write(function () use ($db, $user) {
                        Portal::saveProfile($db, $user);
                    });
                }
            } catch (Fault $error) {
                $session->set('oauth_error', $error->getMessage());
                return $this->redirect($next);
            }
            $session->flush();
            Session::$secure = str_starts_with($config['origin'], 'https://');
            $request->sessionRegenerateId(true);
            $request->session()->set('user', $user['id']);
            $request->session()->set('csrf', Config::token());
            return $this->redirect($next);
        });
    }

    private function opensslCommand(): string
    {
        $configured = getenv('CASHIER_OPENSSL');
        if ($configured) {
            return $configured;
        }
        if (DIRECTORY_SEPARATOR === '\\') {
            foreach (explode(PATH_SEPARATOR, getenv('PATH') ?: '') as $directory) {
                if ($directory !== '' && is_file(rtrim($directory, '/\\') . '/openssl.exe')) {
                    return 'openssl';
                }
            }
            $programFiles = getenv('ProgramFiles');
            if ($programFiles && is_file($programFiles . '/Git/usr/bin/openssl.exe')) {
                return $programFiles . '/Git/usr/bin/openssl.exe';
            }
        }
        return 'openssl';
    }

    private function finishInstall(array $config, array $user): void
    {
        $this->configLock(function () use ($config, $user) {
            $path = Config::runtime('setup.hash');
            if (Config::read() || !is_file($path) || !hash_equals($config['setup_hash'], trim((string) file_get_contents($path)))) {
                throw new Fault('安装状态已变化，请重新访问安装页', 409);
            }
            unset($config['setup_hash']);
            try {
                $config['keys'] = Crypto::generate($config['openssl']);
                openssl_digest('known', 'sm3');
            } catch (\Throwable) {
                throw new Fault('无法初始化国密算法，请检查 CASHIER_OPENSSL、OpenSSL 3 命令路径和 PHP SM3 支持', 500);
            }
            $db = new Store($config);
            $db->initialize();
            $db->write(function () use ($db, $user, $config) {
                $meta = $db->get('system', 'installation');
                if ($meta && $meta['origin'] !== $config['origin']) {
                    throw new Fault('数据库已有另一套清算环境', 409);
                }
                $existing = $db->get('system', 'admin');
                if ($existing && $existing['id'] !== $user['id']) {
                    throw new Fault('此数据库已有超级管理员，请使用原 Portal 账号恢复', 409);
                }
                $db->put('system', 'installation', ['origin' => $config['origin']]);
                $db->put('system', 'admin', ['id' => $user['id']]);
                Portal::saveProfile($db, $user, true);
            });
            Config::save($config);
            @unlink($path);
        });
    }

    private function configurePlugin(string $public): void
    {
        $this->configLock(function () use ($public) {
            $config = Config::read() ?? throw new Fault('系统未安装', 409);
            $config['plugin_public'] = Crypto::validatePublic($config['openssl'], $public);
            Config::save($config);
        });
    }

    private function configLock(callable $callback): void
    {
        $file = fopen(Config::runtime('config.lock'), 'c');
        if (!$file || !flock($file, LOCK_EX)) {
            throw new \RuntimeException('Cannot lock configuration');
        }
        try {
            $callback();
        } finally {
            fclose($file);
        }
    }

    public function merchant(Request $request): Response
    {
        return $this->attempt(function () use ($request) {
            $config = Config::read() ?? throw new Fault('系统未安装', 503);
            $db = new Store($config);
            $clearing = new Clearing($db, $config);
            $id = (string) $request->header('x-merchant-id', '');
            $keyId = (string) $request->header('x-key-id', '');
            if (!preg_match('/\A[0-9a-f]{32}\z/', $id) || !preg_match('/\A[0-9a-f]{32}\z/', $keyId)) {
                throw new Fault('需要商户号和 API Key', 401, 'INVALID_CREDENTIALS');
            }
            $merchant = $db->get('merchant', $id);
            if (!$merchant || ($merchant['key_id'] ?? '') !== $keyId) {
                throw new Fault('商户密钥无效', 401, 'INVALID_CREDENTIALS');
            }
            $input = Crypto::open($config['openssl'], $this->body($request), $config['keys']['private'],
                $merchant['public_key'], 'merchant-request');
            if (($input['merchant'] ?? '') !== $id || ($input['key_id'] ?? '') !== $keyId
                || !is_int($input['timestamp'] ?? null) || abs(time() - $input['timestamp']) > 300) {
                throw new Fault('报文归属或时间戳无效', 401, 'INVALID_REQUEST_CONTEXT');
            }
            $challenge = Clearing::text($input, 'challenge', 100);
            $environment = is_string($input['environment'] ?? null) ? $input['environment'] : '';
            try {
                $payload = ['ok' => true, 'result' => $clearing->command($merchant, $environment, $input)];
                $status = 200;
            } catch (Fault $error) {
                $payload = ['ok' => false, 'code' => $error->errorCode(), 'error' => $error->getMessage()];
                $status = $error->status;
            }
            $payload += ['merchant' => $id, 'key_id' => $keyId, 'environment' => $environment,
                'request_id' => $input['request_id'] ?? null, 'timestamp' => time(), 'challenge' => $challenge];
            $sealed = Crypto::seal($config['openssl'], $config['keys']['private'], $merchant['public_key'],
                'merchant-response', $payload);
            return $this->json($sealed, $status);
        });
    }

    private function session(Request $request, ?array $config): Session
    {
        Session::$secure = str_starts_with($config['origin'] ?? '', 'https://');
        return $request->session();
    }

    private function body(Request $request, int $max = 131072): array
    {
        if (strlen($request->rawBody()) > $max || !str_starts_with(strtolower((string) $request->header('content-type')), 'application/json')) {
            throw new Fault('需要 application/json 且内容大小必须在允许范围内', 415);
        }
        return Config::decode($request->rawBody());
    }

    private function csrf(Request $request, Session $session): void
    {
        $token = $session->get('csrf');
        if (!$token || !hash_equals($token, (string) $request->header('x-csrf-token', ''))) {
            throw new Fault('会话验证已过期，请刷新页面', 403);
        }
    }

    private function admin(array $user): void
    {
        if (!$user['admin']) {
            throw new Fault('需要超级管理员权限', 403);
        }
    }

    private function publicUser(?array $user): ?array
    {
        if ($user !== null) {
            if (!in_array($user['minecraft_source'] ?? '', ['portal', 'admin'], true)) {
                unset($user['uuid']);
                if (!isset($user['minecraft_status'])) {
                    unset($user['minecraft_name']);
                }
            }
            unset($user['link_code'], $user['minecraft_source']);
        }
        return $user;
    }

    private function balanceView(?array $balance): ?array
    {
        if ($balance !== null) {
            unset($balance['uuid']);
            $balance['values'] = (object) $balance['values'];
        }
        return $balance;
    }

    private function playerView(array $order): array
    {
        unset($order['uuid'], $order['target'], $order['payer'], $order['pending_request'], $order['request'], $order['attempt']);
        return $order;
    }

    private function attempt(callable $callback): Response
    {
        try {
            return $callback();
        } catch (Fault $e) {
            return $this->json(['code' => $e->errorCode(), 'error' => $e->getMessage()], $e->status);
        } catch (\JsonException | \TypeError) {
            return $this->json(['code' => 'INVALID_PARAMETER', 'error' => '请求参数格式错误'], 400);
        } catch (\Throwable $e) {
            error_log('Cashier request failed: ' . get_class($e) . ' at ' . basename($e->getFile()) . ':' . $e->getLine());
            return $this->json(['code' => 'INTERNAL_ERROR', 'error' => '清算服务暂不可用'], 500);
        }
    }

    private function redirect(string $url): Response
    {
        return new Response(303, self::HEADERS + ['Location' => $url]);
    }

    private function json(array $body, int $status = 200): Response
    {
        return new Response($status, self::HEADERS + ['Content-Type' => 'application/json; charset=utf-8'], Config::json($body));
    }
}

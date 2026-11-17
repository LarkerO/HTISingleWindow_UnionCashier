<?php
declare(strict_types=1);

namespace Cashier;

final class Clearing
{
    public const RAILS = ['vault', 'scoreboard'];
    public const PRODUCTS = ['pay', 'hold', 'agreement', 'refund', 'split', 'payout'];
    public const MONEY_LIMIT = 2_000_000_000;

    public function __construct(public readonly Store $db, private readonly array $config)
    {
    }

    public static function text(array $input, string $key, int $max = 100): string
    {
        $value = $input[$key] ?? null;
        if (!is_string($value) || $value === '' || strlen($value) > $max || preg_match('/[\x00-\x1f\x7f]/', $value)) {
            throw new Fault('无效参数 ' . $key);
        }
        return $value;
    }

    public static function amount(mixed $amount, bool $zero = false): int
    {
        if (!is_int($amount) || $amount < ($zero ? 0 : 1) || $amount > self::MONEY_LIMIT) {
            throw new Fault('金额必须为有效的整数，最大 20 亿');
        }
        return $amount;
    }

    public function user(string $id): array
    {
        return $this->db->get('user', $id) ?? throw new Fault('Portal 账号尚未登录本系统', 404);
    }

    public function linkCode(string $id): string
    {
        return $this->db->write(function () use ($id) {
            $user = $this->user($id);
            if (isset($user['uuid'])) {
                throw new Fault('账号已绑定 Minecraft 玩家', 409);
            }
            if (isset($user['link_code'])) {
                $this->db->delete('link', $user['link_code']);
            }
            $code = bin2hex(random_bytes(9));
            $this->db->put('link', $code, ['user' => $id, 'expires' => time() + 600]);
            $user['link_code'] = $code;
            $this->db->put('user', $id, $user);
            return $code;
        });
    }

    public function bind(string $code, string $uuid, string $name): void
    {
        if (!preg_match('/\A[a-z0-9]{18}\z/', $code)
            || !preg_match('/\A[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\z/', $uuid)) {
            throw new Fault('无效绑定信息');
        }
        $this->db->write(function () use ($code, $uuid, $name) {
            $link = $this->db->get('link', $code);
            if (!$link || $link['expires'] < time() || $this->db->get('uuid', $uuid)) {
                throw new Fault('绑定码已失效或玩家已绑定');
            }
            $user = $this->user($link['user']);
            if (isset($user['uuid']) || ($user['link_code'] ?? '') !== $code) {
                throw new Fault('绑定码已失效');
            }
            unset($user['link_code']);
            $user['uuid'] = $uuid;
            $user['minecraft_name'] = mb_substr($name, 0, 50);
            $this->db->put('uuid', $uuid, ['user' => $user['id']]);
            $this->db->put('user', $user['id'], $user);
            $this->db->delete('link', $code);
        });
    }

    public function merchant(string $id): array
    {
        return $this->db->get('merchant', $id) ?? throw new Fault('商户不存在', 404);
    }

    public function manage(array $user, string $id, bool $admin = false): array
    {
        $merchant = $this->merchant($id);
        $role = $merchant['members'][$user['id']] ?? null;
        if (!$user['admin'] && (!$role || ($admin && $role !== 'admin'))) {
            throw new Fault('商户权限不足', 403);
        }
        return $merchant;
    }

    public function merchantSettings(array $user, string $action, array $data): array
    {
        return $this->db->write(function () use ($user, $action, $data) {
            if ($action === 'onboard') {
                $owner = $user['admin'] && !empty($data['owner']) ? self::text($data, 'owner') : $user['id'];
                $this->user($owner);
                $id = Config::token();
                $merchant = [
                    'id' => $id, 'name' => self::text($data, 'name', 180), 'state' => 'pending',
                    'members' => [$owner => 'admin'], 'products' => [], 'origins' => [],
                ];
            } else {
                $id = self::text($data, 'merchant');
                $merchant = $this->manage($user, $id, true);
                switch ($action) {
                    case 'review':
                        if (!$user['admin']) {
                            throw new Fault('需要超级管理员权限', 403);
                        }
                        $state = self::text($data, 'state');
                        if (!in_array($state, ['approved', 'rejected', 'pending'], true)) {
                            throw new Fault('无效审核状态');
                        }
                        $products = $data['products'] ?? null;
                        if (!is_array($products) || array_diff($products, self::PRODUCTS)) {
                            throw new Fault('无效能力产品');
                        }
                        $merchant['state'] = $state;
                        $merchant['products'] = array_values(array_unique($products));
                        break;
                    case 'settings':
                        $origins = $data['origins'] ?? [];
                        if (!is_array($origins) || count($origins) > 10) {
                            throw new Fault('最多允许十个返回来源');
                        }
                        $merchant['origins'] = array_values(array_unique(array_map(
                            static fn (string $url) => Config::origin(Config::url($url, true)), $origins)));
                        if (!empty($data['public_key'])) {
                            $merchant['public_key'] = Crypto::validatePublic($this->config['openssl'], (string) $data['public_key']);
                            $merchant['key_id'] = Config::token();
                        }
                        break;
                    case 'member':
                        $member = self::text($data, 'user');
                        $this->user($member);
                        $role = self::text($data, 'role');
                        if ($role === 'remove') {
                            unset($merchant['members'][$member]);
                        } elseif (in_array($role, ['admin', 'operator'], true)) {
                            $merchant['members'][$member] = $role;
                        } else {
                            throw new Fault('无效商户角色');
                        }
                        if (!in_array('admin', $merchant['members'], true)) {
                            throw new Fault('商户必须至少保留一位管理员');
                        }
                        break;
                    default:
                        throw new Fault('未知商户设置', 404);
                }
            }
            $this->db->put('merchant', $id, $merchant);
            return $merchant;
        });
    }

    public function order(string $id): array
    {
        return $this->db->get('order', $id) ?? throw new Fault('订单不存在', 404);
    }

    public function command(array $merchant, string $env, array $data, bool $console = false): array
    {
        if (!in_array($env, ['live', 'sandbox'], true)) {
            throw new Fault('无效交易环境');
        }
        $action = self::text($data, 'action');
        return $this->db->write(function () use ($merchant, $env, $data, $console, $action) {
            $current = $this->merchant($merchant['id']);
            if (!$console && ($current['key_id'] ?? null) !== ($merchant['key_id'] ?? null)) {
                throw new Fault('商户密钥已轮换', 401);
            }
            $merchant = $current;
            if ($action === 'query') {
                $this->requireMerchant($merchant, $env);
                return isset($data['request_id'])
                    ? $this->requestResult($this->db->get('request', $this->requestKey($merchant['id'], $env, self::text($data, 'request_id'))))
                    : $this->ownedOrder($merchant, $env, self::text($data, 'order_id'));
            }
            $requestId = self::text($data, 'request_id');
            $key = $this->requestKey($merchant['id'], $env, $requestId);
            unset($data['challenge'], $data['timestamp'], $data['merchant'], $data['key_id'], $data['environment']);
            ksort($data);
            $fingerprint = openssl_digest(Config::json($data), 'sm3');
            $existing = $this->db->get('request', $key);
            if ($existing) {
                if (!hash_equals($existing['fingerprint'], $fingerprint)) {
                    throw new Fault('同一请求编号已用于不同参数', 409);
                }
                return $this->requestResult($existing);
            }

            $product = match ($action) {
                'create' => self::text($data, 'kind'),
                'capture' => 'hold',
                'debit' => 'agreement',
                'refund', 'split', 'payout' => $action,
                default => throw new Fault('未知接口', 404),
            };
            if (!in_array($product, self::PRODUCTS, true)) {
                throw new Fault('未知产品');
            }
            $this->requireMerchant($merchant, $env, $product, $console);
            $request = ['id' => $key, 'request_id' => $requestId, 'fingerprint' => $fingerprint,
                'status' => 'completed', 'action' => $action, 'env' => $env, 'merchant' => $merchant['id']];
            if ($action === 'create') {
                $order = $this->create($merchant, $env, $data);
                $request['result_order'] = $order['id'];
            } elseif (in_array($action, ['capture', 'debit', 'refund'], true)) {
                $this->orderOperation($merchant, $env, $data, $request);
            } else {
                $this->transfer($merchant, $env, $data, $request);
            }
            $this->db->put('request', $key, $request, $merchant['id']);
            return $this->requestResult($request);
        });
    }

    private function requireMerchant(array $merchant, string $env, ?string $product = null, bool $console = false): void
    {
        if ($env === 'live' && $merchant['state'] !== 'approved') {
            throw new Fault('商户尚未获准正式交易', 403);
        }
        if ($product && (!$console || $env === 'live') && !in_array($product, $merchant['products'], true)) {
            throw new Fault('商户未开通该产品', 403);
        }
    }

    private function requestKey(string $merchant, string $env, string $id): string
    {
        return openssl_digest(Config::json([$merchant, $env, $id]), 'sm3');
    }

    private function requestResult(?array $request): array
    {
        if (!$request) {
            throw new Fault('请求不存在', 404);
        }
        unset($request['fingerprint'], $request['id']);
        if (isset($request['result_order'])) {
            return ['request' => $request, 'order' => $this->order($request['result_order'])];
        }
        return ['request' => $request];
    }

    private function ownedOrder(array $merchant, string $env, string $id): array
    {
        $order = $this->order($id);
        if ($order['merchant'] !== $merchant['id'] || $order['env'] !== $env) {
            throw new Fault('订单不存在', 404);
        }
        return $order;
    }

    private function create(array $merchant, string $env, array $data): array
    {
        $kind = $data['kind'];
        if (!in_array($kind, ['pay', 'hold', 'agreement'], true)) {
            throw new Fault('无效订单类型');
        }
        $return = (string) ($data['return_url'] ?? '');
        if ($return !== '') {
            Config::url($return);
            if (!in_array(Config::origin($return), $merchant['origins'], true)) {
                throw new Fault('返回地址来源未在商户后台登记');
            }
        }
        $number = self::text($data, 'out_trade_no');
        $reference = openssl_digest(Config::json([$merchant['id'], $env, $number]), 'sm3');
        if ($this->db->get('out_trade', $reference)) {
            throw new Fault('商户订单号已存在', 409);
        }
        $target = empty($data['user']) ? null : $this->user(self::text($data, 'user'))['id'];
        $id = Config::token();
        $order = [
            'id' => $id, 'merchant' => $merchant['id'], 'merchant_name' => $merchant['name'],
            'env' => $env, 'kind' => $kind, 'status' => 'pending', 'title' => self::text($data, 'title', 240),
            'out_trade_no' => $number, 'return_url' => $return, 'target' => $target,
            'amount' => $kind === 'agreement' ? 0 : self::amount($data['amount'] ?? null),
            'refunded' => 0, 'created' => time(), 'expires' => time() + 1800,
            'checkout_url' => $this->config['origin'] . '/checkout/' . $id,
        ];
        $this->db->put('out_trade', $reference, ['id' => $id]);
        $this->saveOrder($order);
        return $order;
    }

    public function playerOrder(array $user, string $id): array
    {
        $order = $this->order($id);
        foreach (['target', 'payer'] as $field) {
            if (isset($order[$field]) && $order[$field] !== $user['id']) {
                throw new Fault('订单不属于当前账号', 403);
            }
        }
        return $order;
    }

    public function playerAction(array $user, string $id, string $action, array $methods = []): array
    {
        return $this->db->write(function () use ($user, $id, $action, $methods) {
            $order = $this->playerOrder($user, $id);
            $user = $this->user($user['id']);
            if ($action === 'revoke') {
                if ($order['status'] !== 'active' || $order['kind'] !== 'agreement' || ($order['payer'] ?? '') !== $user['id']) {
                    throw new Fault('当前签约不可解约', 409);
                }
                $order['status'] = 'revoked';
            } else {
                if ($order['status'] !== 'pending' || $order['expires'] < time()) {
                    throw new Fault('订单已处理、处理中或已过期', 409);
                }
                $this->requireMerchant($this->merchant($order['merchant']), $order['env'], $order['env'] === 'live' ? $order['kind'] : null);
                foreach ($methods as $method) {
                    if (!in_array($method, self::RAILS, true)) {
                        throw new Fault('支付方式无效');
                    }
                }
                $methods = array_values(array_unique($methods));
                if (!$methods || ($order['kind'] === 'pay' && count($methods) !== 1)) {
                    throw new Fault('请选择有效的支付方式');
                }
                $order['payer'] = $user['id'];
                $order['uuid'] = $this->wallet($user, $order['env']);
                $order['methods'] = $methods;
                if ($order['kind'] === 'agreement') {
                    $order['status'] = 'active';
                } else {
                    $order['status'] = 'processing';
                    $this->queue('order', $id, $order['env'], 'debit', $methods, $order['uuid'], $order['amount']);
                }
            }
            $this->saveOrder($order);
            return $order;
        });
    }

    private function wallet(array $user, string $env): string
    {
        return $env === 'sandbox' ? $user['id'] : ($user['uuid'] ?? throw new Fault('请先绑定 Minecraft 玩家'));
    }

    private function saveOrder(array $order): void
    {
        $this->db->put('order', $order['id'], $order, $order['merchant']);
        if (isset($order['payer'])) {
            $this->db->put('player_order', $order['id'], ['id' => $order['id']], $order['payer']);
        }
    }

    private function orderOperation(array $merchant, string $env, array $data, array &$request): void
    {
        $order = $this->ownedOrder($merchant, $env, self::text($data, 'order_id'));
        $action = $request['action'];
        $amount = self::amount($data['amount'] ?? null, $action === 'capture');
        $request += ['order_id' => $order['id'], 'amount' => $amount];
        if ($action === 'debit') {
            if ($order['kind'] !== 'agreement' || $order['status'] !== 'active') {
                throw new Fault('签约未生效或已解约', 409);
            }
            $id = Config::token();
            $payment = [
                'id' => $id, 'merchant' => $order['merchant'], 'merchant_name' => $order['merchant_name'],
                'env' => $env, 'kind' => 'pay', 'status' => 'processing', 'title' => $order['title'],
                'payer' => $order['payer'], 'uuid' => $order['uuid'], 'methods' => $order['methods'],
                'amount' => $amount, 'refunded' => 0, 'created' => time(),
                'out_trade_no' => $request['request_id'], 'agreement_id' => $order['id'],
            ];
            $request['result_order'] = $id;
            $request['status'] = 'processing';
            $payment['request'] = $request['id'];
            $this->saveOrder($payment);
            $this->queue('order', $id, $env, 'debit', $order['methods'], $order['uuid'], $amount);
            return;
        }
        if (isset($order['pending_request'])) {
            throw new Fault('订单已有未完成的资金操作', 409);
        }
        $rail = $order['rail'] ?? '';
        if ($action === 'capture') {
            if ($order['status'] !== 'held' || $amount > $order['amount']) {
                throw new Fault('订单未冻结或超出冻结金额', 409);
            }
            $return = $order['amount'] - $amount;
            if ($return === 0) {
                $this->capture($order, $amount);
                $request['result_order'] = $order['id'];
                return;
            }
        } else {
            if ($order['status'] !== 'paid' || $amount > $order['captured'] - $order['refunded']) {
                throw new Fault('订单不可退款或超出可退金额', 409);
            }
            $this->ledger($merchant['id'], $env, $rail, -$amount);
            $return = $amount;
        }
        $order['pending_request'] = $request['id'];
        $this->saveOrder($order);
        $request['result_order'] = $order['id'];
        $request['status'] = 'processing';
        $request['rail'] = $rail;
        $this->queue('request', $request['id'], $env, 'credit', [$rail], $order['uuid'], $return);
    }

    private function capture(array &$order, int $amount): void
    {
        if ($amount > 0) {
            $this->ledger($order['merchant'], $order['env'], $order['rail'], $amount);
        }
        $order['captured'] = $amount;
        $order['status'] = $amount > 0 ? 'paid' : 'released';
        $this->saveOrder($order);
    }

    private function transfer(array $merchant, string $env, array $data, array &$request): void
    {
        $rail = self::text($data, 'rail');
        if (!in_array($rail, self::RAILS, true)) {
            throw new Fault('无效支付方式');
        }
        $target = $request['action'] === 'payout'
            ? $this->user($this->db->get('system', 'admin')['id'])
            : $this->user(self::text($data, 'user'));
        $wallet = $this->wallet($target, $env);
        $amount = self::amount($data['amount'] ?? null);
        $this->ledger($merchant['id'], $env, $rail, -$amount);
        $request += ['amount' => $amount, 'rail' => $rail, 'user' => $target['id']];
        $request['status'] = 'processing';
        $this->queue('request', $request['id'], $env, 'credit', [$rail], $wallet, $amount);
    }

    private function ledger(string $merchant, string $env, string $rail, int $delta): void
    {
        $id = "$merchant:$env:$rail";
        $row = $this->db->get('ledger', $id) ?? ['env' => $env, 'rail' => $rail, 'balance' => 0];
        $balance = $row['balance'] + $delta;
        if ($balance < 0) {
            throw new Fault('商户在该支付方式下余额不足', 409);
        }
        $row['balance'] = $balance;
        $this->db->put('ledger', $id, $row, $merchant);
    }

    public function balance(array $user): array
    {
        return $this->db->write(function () use ($user) {
            $uuid = $this->wallet($user, 'live');
            $existing = $this->db->get('balance', $user['id']);
            if ($existing && $existing['requested'] > time() - 10) {
                return $existing;
            }
            $row = ['requested' => time(), 'values' => []];
            $this->db->put('balance', $user['id'], $row);
            foreach (self::RAILS as $rail) {
                $this->queue('balance', $user['id'], 'live', 'balance', [$rail], $uuid, 0);
            }
            return $row;
        });
    }

    private function queue(string $type, string $parent, string $env, string $action, array $methods, string $uuid, int $amount): void
    {
        $id = Config::token();
        $job = ['id' => $id, 'type' => $type, 'parent' => $parent, 'env' => $env, 'action' => $action,
            'rail' => array_shift($methods), 'rest' => $methods, 'uuid' => $uuid, 'amount' => $amount, 'created' => time()];
        $this->db->put('job', $id, $job, $env);
    }

    public function next(string $env): ?array
    {
        $jobs = $this->db->list('job', $env);
        usort($jobs, static fn (array $a, array $b) => $a['created'] <=> $b['created']);
        return $jobs[0] ?? null;
    }

    public function sandbox(array $job): void
    {
        $this->db->write(function () use ($job) {
            if (!$this->db->get('job', $job['id'])) {
                return;
            }
            $key = $job['uuid'] . ':' . $job['rail'];
            $balance = $this->db->get('sandbox_wallet', $key)['balance'] ?? 100000;
            $delta = $job['action'] === 'credit' ? $job['amount'] : -$job['amount'];
            $jobOk = $balance + $delta >= 0 && $balance + $delta <= self::MONEY_LIMIT;
            if ($jobOk && $job['action'] !== 'balance') {
                $balance += $delta;
                $this->db->put('sandbox_wallet', $key, ['balance' => $balance]);
            }
            $this->finish($job, $jobOk ? 'ok' : 'insufficient', $balance);
        });
    }

    public function result(string $id, string $status, mixed $balance = null): void
    {
        $this->db->write(function () use ($id, $status, $balance) {
            $job = $this->db->get('job', $id);
            if ($job && $job['env'] === 'live') {
                $this->finish($job, $status, $balance);
            }
        });
    }

    private function finish(array $job, string $status, mixed $balance): void
    {
        $ok = $status === 'ok';
        $this->db->delete('job', $job['id']);
        if ($status === 'uncertain') {
            $job['review_status'] = 'pending';
            $this->db->put('review', $job['id'], $job);
            return;
        }
        if (!$ok && in_array($status, ['insufficient', 'unavailable', 'range'], true) && $job['action'] === 'debit' && $job['rest']) {
            $this->queue($job['type'], $job['parent'], $job['env'], $job['action'], $job['rest'], $job['uuid'], $job['amount']);
            return;
        }
        if ($job['type'] === 'balance') {
            $row = $this->db->get('balance', $job['parent']);
            $row['values'][$job['rail']] = $ok ? $balance : null;
            $this->db->put('balance', $job['parent'], $row);
            return;
        }
        if ($job['type'] === 'order') {
            $order = $this->order($job['parent']);
            if ($ok) {
                $order['rail'] = $job['rail'];
                if ($order['kind'] === 'hold') {
                    $order['status'] = 'held';
                } else {
                    $this->capture($order, $order['amount']);
                }
            } else {
                $order['status'] = 'failed';
                $order['failure'] = $status;
            }
            $this->saveOrder($order);
            if (isset($order['request'])) {
                $request = $this->db->get('request', $order['request']);
                $this->finishRequest($request, $ok, $status);
            }
            return;
        }
        $request = $this->db->get('request', $job['parent']);
        if (isset($request['order_id'])) {
            $order = $this->order($request['order_id']);
            unset($order['pending_request']);
            if ($ok && $request['action'] === 'capture') {
                $this->capture($order, $request['amount']);
            }
            if ($ok && $request['action'] === 'refund') {
                $order['refunded'] += $request['amount'];
            }
            $this->saveOrder($order);
        }
        if (!$ok && in_array($request['action'], ['refund', 'split', 'payout'], true)) {
            $this->ledger($request['merchant'], $request['env'], $request['rail'], $request['amount']);
        }
        $this->finishRequest($request, $ok, $status);
    }

    private function finishRequest(array $request, bool $ok, string $status): void
    {
        $request['status'] = $ok ? 'completed' : 'failed';
        if (!$ok) {
            $request['failure'] = $status;
        }
        $this->db->put('request', $request['id'], $request, $request['merchant']);
    }

    public function resolveReview(string $id, bool $applied): void
    {
        $this->db->write(function () use ($id, $applied) {
            $job = $this->db->get('review', $id);
            if (!$job || $job['review_status'] !== 'pending') {
                throw new Fault('复核记录不存在或已处理', 409);
            }
            $this->finish($job, $applied ? 'ok' : 'reconciled_failure', null);
            $job['review_status'] = $applied ? 'applied' : 'not_applied';
            $job['resolved'] = time();
            $this->db->put('review', $id, $job);
        });
    }
}

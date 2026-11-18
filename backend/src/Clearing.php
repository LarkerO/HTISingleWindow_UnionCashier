<?php
declare(strict_types=1);

namespace Cashier;

final class Clearing
{
    public const RAILS = ['vault', 'scoreboard'];
    public const PRODUCTS = ['pay', 'hold', 'agreement', 'refund', 'split', 'payout'];
    public const MONEY_LIMIT = 2_000_000_000;

    public readonly Cards $cards;
    public readonly Limits $limits;
    public readonly Statements $statements;

    public function __construct(public readonly Store $db, private readonly array $config)
    {
        $this->cards = new Cards($this, $config);
        $this->limits = new Limits($db);
        $this->statements = new Statements($db);
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
                    case 'settlement':
                        if (!$user['admin']) {
                            throw new Fault('需要超级管理员权限', 403);
                        }
                        $cycle = self::text($data, 'cycle');
                        if (!in_array($cycle, ['D+0', 'T+0', 'T+1', 'T+2'], true)) {
                            throw new Fault('清算规则无效');
                        }
                        $merchant['cycle'] = $cycle;
                        $merchant['limits'] = ['single' => Limits::value($data, 'single'),
                            'monthly' => Limits::value($data, 'monthly'), 'count' => Limits::value($data, 'count')];
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
        return $this->db->get('order', $id) ?? throw new Fault('订单不存在', 404, 'ORDER_NOT_FOUND');
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
            if ($action === 'statement') {
                $this->requireMerchant($merchant, $env);
                return $this->statements->read(null, $merchant['id'], $data + ['environment' => $env]);
            }
            $requestId = self::text($data, 'request_id');
            $key = $this->requestKey($merchant['id'], $env, $requestId);
            unset($data['challenge'], $data['timestamp'], $data['merchant'], $data['key_id'], $data['environment']);
            ksort($data);
            $fingerprint = openssl_digest(Config::json($data), 'sm3');
            $existing = $this->db->get('request', $key);
            if ($existing) {
                if (!hash_equals($existing['fingerprint'], $fingerprint)) {
                    throw new Fault('同一请求编号已用于不同参数', 409, 'IDEMPOTENCY_CONFLICT');
                }
                return $this->requestResult($existing);
            }

            $product = match ($action) {
                'create' => self::text($data, 'kind'),
                'capture' => 'hold',
                'debit', 'revoke' => 'agreement',
                'refund', 'split', 'payout' => $action,
                'card_bind' => null,
                default => throw new Fault('未知接口', 404, 'UNKNOWN_ACTION'),
            };
            if ($product !== null && !in_array($product, self::PRODUCTS, true)) {
                throw new Fault('未知产品');
            }
            $this->requireMerchant($merchant, $env, $product, $console);
            $request = ['id' => $key, 'request_id' => $requestId, 'fingerprint' => $fingerprint,
                'status' => 'completed', 'action' => $action, 'env' => $env, 'merchant' => $merchant['id']];
            if ($action === 'create') {
                $order = $this->create($merchant, $env, $data);
                $request['result_order'] = $order['id'];
            } elseif ($action === 'card_bind') {
                $request['card'] = $this->cards->redeem(self::text($data, 'user'), $data, $merchant['id'], $env);
            } elseif ($action === 'revoke') {
                $order = $this->ownedOrder($merchant, $env, self::text($data, 'order_id'));
                if ($order['kind'] !== 'agreement' || !in_array($order['status'], ['active', 'revoked'], true)) {
                    throw new Fault('签约尚未生效或订单类型不符', 409, 'AGREEMENT_INACTIVE');
                }
                if ($order['status'] === 'active') {
                    $this->revokeAgreement($order);
                }
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
            throw new Fault('商户尚未获准正式交易', 403, 'MERCHANT_NOT_APPROVED');
        }
        if ($product && (!$console || $env === 'live') && !in_array($product, $merchant['products'], true)) {
            throw new Fault('商户未开通该产品', 403, 'PRODUCT_DISABLED');
        }
    }

    private function requestKey(string $merchant, string $env, string $id): string
    {
        return openssl_digest(Config::json([$merchant, $env, $id]), 'sm3');
    }

    private function requestResult(?array $request): array
    {
        if (!$request) {
            throw new Fault('请求不存在', 404, 'REQUEST_NOT_FOUND');
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
            throw new Fault('订单不存在', 404, 'ORDER_NOT_FOUND');
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
                throw new Fault('返回地址来源未在商户后台登记', 400, 'RETURN_ORIGIN_DENIED');
            }
        }
        $number = self::text($data, 'out_trade_no');
        $reference = openssl_digest(Config::json([$merchant['id'], $env, $number]), 'sm3');
        if ($this->db->get('out_trade', $reference)) {
            throw new Fault('商户订单号已存在', 409, 'DUPLICATE_TRADE_NO');
        }
        $target = empty($data['user']) ? null : $this->user(self::text($data, 'user'))['id'];
        $amount = $kind === 'agreement' ? 0 : self::amount($data['amount'] ?? null);
        if ($kind !== 'agreement') {
            $this->limits->merchant($merchant, $env, $amount);
        }
        $id = Config::token();
        $order = [
            'id' => $id, 'merchant' => $merchant['id'], 'merchant_name' => $merchant['name'],
            'env' => $env, 'kind' => $kind, 'status' => 'pending', 'title' => self::text($data, 'title', 240),
            'out_trade_no' => $number, 'return_url' => $return, 'target' => $target,
            'amount' => $amount,
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

    public function paymentCards(array $user, array $order): array
    {
        $order['payer'] = $user['id'];
        return array_values(array_filter($this->db->list('card', $user['id']), fn ($card) =>
            $this->cards->eligible($order, $card['number'], $order['amount'], $this->wallet($user, $order['env'], false) !== null) !== null));
    }

    public function paymentOrder(string $user): array
    {
        $cards = array_values(array_filter($this->db->list('card', $user), static fn (array $card) =>
            $card['owner'] === $user && $card['state'] === 'active'));
        $methods = $this->db->get('payment_order', $user)['methods'] ?? self::RAILS;
        $available = [...self::RAILS, ...array_map(static fn (array $card) => 'card:' . $card['number'], $cards)];
        return [
            'methods' => array_values(array_intersect($methods, $available)),
            'cards' => array_map(static fn (array $card) => [
                'number' => $card['number'], 'name' => $card['terms']['name'], 'env' => $card['env'],
            ], $cards),
        ];
    }

    public function savePaymentOrder(string $user, mixed $methods): array
    {
        if (!is_array($methods) || !array_is_list($methods) || count($methods) > 8) {
            throw new Fault('支付顺序最多可包含 8 种支付方式');
        }
        return $this->db->write(function () use ($user, $methods) {
            $cards = $this->paymentOrder($user)['cards'];
            $available = [...self::RAILS, ...array_map(static fn (array $card) => 'card:' . $card['number'], $cards)];
            $seen = [];
            foreach ($methods as $method) {
                if (!is_string($method) || !in_array($method, $available, true) || isset($seen[$method])) {
                    throw new Fault('支付顺序包含重复或不可用的支付方式');
                }
                $seen[$method] = true;
            }
            if (array_diff(self::RAILS, $methods)) {
                throw new Fault('支付顺序须包含 Vault 和计分板');
            }
            $this->db->put('payment_order', $user, ['methods' => $methods]);
            return ['methods' => $methods, 'cards' => $cards];
        });
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
                $this->revokeAgreement($order);
                return $order;
            } else {
                if ($order['status'] !== 'pending' || $order['expires'] < time()) {
                    throw new Fault('订单已处理、处理中或已过期', 409);
                }
                $this->requireMerchant($this->merchant($order['merchant']), $order['env'], $order['env'] === 'live' ? $order['kind'] : null);
                foreach ($methods as $method) {
                    if (!is_string($method) || (!in_array($method, self::RAILS, true) && !preg_match('/\Acard:[a-f0-9]{32}\z/', $method))) {
                        throw new Fault('支付方式无效');
                    }
                }
                $methods = array_values(array_unique($methods));
                if (!$methods || count($methods) > 8) {
                    throw new Fault('请选择有效的支付方式');
                }
                $order['payer'] = $user['id'];
                $order['uuid'] = $this->wallet($user, $order['env'], false);
                $order['methods'] = $methods;
                if ($order['kind'] === 'agreement') {
                    foreach ($methods as $method) {
                        if (str_starts_with($method, 'card:') && !$this->cards->eligible($order, substr($method, 5), 0)) {
                            throw new Fault('预付卡不支持该签约场景');
                        }
                    }
                    $order['status'] = 'active';
                } else {
                    $this->limits->merchant($this->merchant($order['merchant']), $order['env'], $order['amount'], $order);
                    $order['limit_time'] = time();
                    $order['status'] = 'processing';
                    $this->advancePayment($order, $methods);
                    if ($order['status'] === 'failed') {
                        throw new Fault('所选方式不可用、余额不足或已超限，请重新选择', 409);
                    }
                }
            }
            $this->saveOrder($order);
            return $order;
        });
    }

    private function revokeAgreement(array &$order): void
    {
        $order['status'] = 'revoked';
        $this->saveOrder($order);
    }

    public function wallet(array $user, string $env, bool $required = true): ?string
    {
        if ($env === 'sandbox') {
            return $user['id'];
        }
        if (($user['minecraft_source'] ?? '') === 'portal' && isset($user['uuid'])) {
            return $user['uuid'];
        }
        return $required ? throw new Fault('请先在 Portal 绑定并公开 Minecraft 玩家档案，再重新登录') : null;
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
                throw new Fault('签约未生效或已解约', 409, 'AGREEMENT_INACTIVE');
            }
            $wallet = $this->wallet($this->user($order['payer']), $env, false);
            if ($wallet !== ($order['uuid'] ?? null)) {
                throw new Fault('签约钱包已变更，请重新签约', 409, 'AGREEMENT_INACTIVE');
            }
            $this->limits->merchant($merchant, $env, $amount);
            $id = Config::token();
            $payment = [
                'id' => $id, 'merchant' => $order['merchant'], 'merchant_name' => $order['merchant_name'],
                'env' => $env, 'kind' => 'pay', 'status' => 'processing', 'title' => $order['title'],
                'payer' => $order['payer'], 'uuid' => $wallet, 'methods' => $order['methods'],
                'amount' => $amount, 'refunded' => 0, 'created' => time(),
                'out_trade_no' => $request['request_id'], 'agreement_id' => $order['id'],
            ];
            $request['result_order'] = $id;
            $request['status'] = 'processing';
            $payment['request'] = $request['id'];
            $this->advancePayment($payment, $payment['methods']);
            $this->saveOrder($payment);
            if ($payment['status'] !== 'processing') {
                $request['status'] = $payment['status'] === 'paid' ? 'completed' : 'failed';
                if (isset($payment['failure'])) {
                    $request['failure'] = $payment['failure'];
                }
            }
            return;
        }
        if (isset($order['pending_request'])) {
            throw new Fault('订单已有未完成的资金操作', 409, 'OPERATION_IN_PROGRESS');
        }
        if ($action === 'capture') {
            if ($order['status'] !== 'held' || $amount > $order['amount']) {
                throw new Fault('订单未冻结或超出冻结金额', 409, 'INVALID_CAPTURE');
            }
            $before = $order['amount'];
            $after = $amount;
        } else {
            $before = ($order['captured'] ?? 0) - $order['refunded'];
            if ($order['status'] !== 'paid' || $amount > $before) {
                throw new Fault('订单不可退款或超出可退金额', 409, 'INVALID_REFUND');
            }
            $after = $before - $amount;
        }
        $request['result_order'] = $order['id'];
        $request['adjustments'] = $this->adjustments($order, $before, $after);
        $game = null;
        foreach ($request['adjustments'] as $part) {
            if ($action === 'refund') {
                $due = $order['settlement_at'] ?? 0;
                $unmatured = $due > time();
                if ($unmatured) {
                    $this->reduceSettlementLot($order, $part);
                    $request['reserved_settlement_at'] = $due;
                }
                $this->ledger($order['merchant'], $env, $part['rail'], -$part['amount'], 0, true);
            }
            if (!isset($part['card'])) {
                $game = $part;
            }
        }
        if (!$game) {
            $this->finishOrderOperation($order, $request, true);
            return;
        }
        $order['pending_request'] = $request['id'];
        $this->saveOrder($order);
        $request['status'] = 'processing';
        $request['rail'] = $game['rail'];
        $this->queue('request', $request['id'], $env, 'credit', [$game['rail']], $order['uuid'], $game['amount']);
    }

    private function advancePayment(array &$order, array $methods): void
    {
        $order['usage_v2'] = true;
        $payer = $order['payer'];
        $env = $order['env'];
        $month = Limits::month();
        $reserved = $order['funding'] ?? [];
        $remaining = $order['amount'] - array_sum(array_column($reserved, 'amount'));
        while ($methods) {
            $method = array_shift($methods);
            if (str_starts_with($method, 'card:')) {
                if ($reserved) {
                    continue;
                }
                $hasGameFallback = array_intersect($methods, self::RAILS) !== [];
                $card = $this->cards->eligible($order, substr($method, 5), $remaining, $hasGameFallback);
                if (!$card) {
                    continue;
                }
                $amount = min($remaining, $card['balance']);
                if (!$this->limits->canUse($payer, $env, 'card', $amount)) {
                    continue;
                }
                $this->limits->use($payer, $env, 'card', $month, 1);
                $this->cards->reserve($card, $amount, $order['id']);
                $order['funding'] = [['card' => $card['number'], 'rail' => $card['rail'], 'amount' => $amount, 'month' => $month]];
                if ($amount === $remaining) {
                    $this->paymentSucceeded($order);
                    return;
                }
                $reserved = $order['funding'];
                $remaining -= $amount;
                continue;
            }
            if (!$order['uuid'] || !$this->limits->canUse($payer, $env, $method, $remaining)) {
                continue;
            }
            $this->limits->use($payer, $env, $method, $month, 1);
            $order['attempt'] = ['rail' => $method, 'amount' => $remaining, 'month' => $month];
            $this->queue('order', $order['id'], $env, 'debit', [$method, ...$methods], $order['uuid'], $remaining);
            return;
        }
        $this->paymentFailed($order, $order['failure'] ?? 'unavailable');
    }

    private function paymentFailed(array &$order, string $status): void
    {
        foreach ($order['funding'] ?? [] as $part) {
            if (isset($part['card'])) {
                $this->cards->settle($part['card'], $part['amount'], $order['id'], 'payment_released', true);
                $this->limits->use($order['payer'], $order['env'], 'card', $part['month'], -1);
            }
        }
        unset($order['funding']);
        $order['status'] = 'failed';
        $order['failure'] = $status;
    }

    private function paymentSucceeded(array &$order): void
    {
        unset($order['failure']);
        $order['rail'] = $order['funding'][0]['rail'];
        if ($order['kind'] === 'hold') {
            $order['status'] = 'held';
        } else {
            $this->capture($order, $order['amount'], []);
        }
    }

    private function allocations(array $order): array
    {
        return $order['funding'] ?? [['rail' => $order['rail'], 'amount' => $order['captured'] ?? $order['amount']]];
    }

    private function adjustments(array $order, int $before, int $after): array
    {
        $result = [];
        foreach ($this->allocations($order) as $part) {
            $keptBefore = min($part['amount'], $before);
            $keptAfter = min($part['amount'], $after);
            $before -= $keptBefore;
            $after -= $keptAfter;
            if ($keptBefore > $keptAfter) {
                $result[] = ['amount' => $keptBefore - $keptAfter] + $part;
            }
        }
        return $result;
    }

    private function capture(array &$order, int $amount, array $adjustments): void
    {
        $remaining = $amount;
        $funding = [];
        $released = array_column(array_filter($adjustments, static fn ($part) => isset($part['card'])), 'amount', 'card');
        $now = time();
        $cycle = $this->merchant($order['merchant'])['cycle'] ?? 'D+0';
        $due = $order['env'] === 'live' ? Limits::due($cycle, $now) : $now;
        foreach ($this->allocations($order) as $part) {
            $used = min($part['amount'], $remaining);
            $remaining -= $used;
            if (isset($part['card'])) {
                $this->cards->settle($part['card'], $released[$part['card']] ?? 0, $order['id'],
                    $used ? 'payment' : 'payment_released', true, $used);
            }
            if ($used) {
                $funding[] = ['amount' => $used] + $part;
                $this->ledger($order['merchant'], $order['env'], $part['rail'], $used, $due);
            }
        }
        $order['funding'] = $funding;
        $order['captured'] = $amount;
        $order['status'] = $amount > 0 ? 'paid' : 'released';
        $order['settlement_at'] = $due;
        $order['rail'] = implode('+', array_unique(array_map(static fn ($part) => isset($part['card']) ? 'card' : $part['rail'], $funding))) ?: $order['rail'];
        $this->statements->append($order, 'payment', $amount, $order['id']);
        $this->saveOrder($order);
    }

    private function finishOrderOperation(array $order, array $request, bool $ok): void
    {
        unset($order['pending_request']);
        if ($ok && $request['action'] === 'capture') {
            $this->capture($order, $request['amount'], $request['adjustments'] ?? []);
            return;
        }
        if ($request['action'] === 'refund') {
            foreach ($request['adjustments'] ?? [['rail' => $request['rail'], 'amount' => $request['amount']]] as $part) {
                if ($ok && isset($part['card'])) {
                    $this->cards->settle($part['card'], $part['amount'], $order['id'], 'refund', false);
                } elseif (!$ok) {
                    $this->ledger($order['merchant'], $order['env'], $part['rail'], $part['amount'],
                        $request['reserved_settlement_at'] ?? 0);
                }
            }
            if ($ok) {
                // Pending refunds from older versions did not reserve their settlement lot.
                if (!isset($request['reserved_settlement_at']) && ($order['settlement_at'] ?? 0) > time()) {
                    foreach ($request['adjustments'] ?? [] as $part) {
                        $this->reduceSettlementLot($order, $part);
                    }
                }
                if (!array_key_exists('legacy_refunded', $order) && !$this->db->get('statement', $order['id'])) {
                    $order['legacy_refunded'] = $order['refunded'];
                }
                $order['refunded'] += $request['amount'];
                $this->statements->append($order, 'refund', -$request['amount']);
            }
        }
        $this->saveOrder($order);
    }

    private function reduceSettlementLot(array $order, array $part): void
    {
        $bucket = "{$order['merchant']}:{$order['env']}:{$part['rail']}";
        $key = $bucket . ':' . $order['settlement_at'];
        $lot = $this->db->get('settlement_lot', $key);
        if ($lot) {
            $lot['amount'] = max(0, $lot['amount'] - $part['amount']);
            $this->db->put('settlement_lot', $key, $lot, $bucket);
        }
    }

    private function transfer(array $merchant, string $env, array $data, array &$request): void
    {
        $rail = self::text($data, 'rail');
        if (!in_array($rail, self::RAILS, true)) {
            throw new Fault('无效支付方式');
        }
        $target = $request['action'] === 'payout'
            ? $this->user(empty($data['user']) ? $this->db->get('system', 'admin')['id'] : self::text($data, 'user'))
            : $this->user(self::text($data, 'user'));
        $wallet = $this->wallet($target, $env);
        $amount = self::amount($data['amount'] ?? null);
        $this->ledger($merchant['id'], $env, $rail, -$amount, 0, true);
        $request += ['amount' => $amount, 'rail' => $rail, 'user' => $target['id']];
        $request['status'] = 'processing';
        $this->queue('request', $request['id'], $env, 'credit', [$rail], $wallet, $amount);
    }

    public function ledger(string $merchant, string $env, string $rail, int $delta, int $due = 0, bool $requireMatured = false): void
    {
        $id = "$merchant:$env:$rail";
        $row = $this->db->get('ledger', $id) ?? ['env' => $env, 'rail' => $rail, 'balance' => 0];
        if ($row['balance'] + $delta < 0 || ($requireMatured && $this->available($merchant, $row) + $delta < 0)) {
            throw new Fault('该支付方式的可用余额不足或仍在清算期', 409, 'MERCHANT_FUNDS_UNAVAILABLE');
        }
        $row['balance'] += $delta;
        $this->db->put('ledger', $id, $row, $merchant);
        if ($delta > 0 && $due > time()) {
            $lot = $id . ':' . $due;
            $amount = ($this->db->get('settlement_lot', $lot)['amount'] ?? 0) + $delta;
            $this->db->put('settlement_lot', $lot, ['amount' => $amount, 'due' => $due], $id);
        }
    }

    public function available(string $merchant, array $row): int
    {
        $blocked = 0;
        foreach ($this->db->list('settlement_lot', "$merchant:{$row['env']}:{$row['rail']}") as $lot) {
            if ($lot['due'] > time()) {
                $blocked += $lot['amount'];
            }
        }
        return max(0, $row['balance'] - $blocked);
    }

    public function balance(array $user): array
    {
        return $this->db->write(function () use ($user) {
            $uuid = $this->wallet($user, 'live');
            $existing = $this->db->get('balance', $user['id']);
            if ($existing && ($existing['uuid'] ?? '') === $uuid && $existing['requested'] > time() - 10) {
                return $existing;
            }
            $row = ['requested' => time(), 'uuid' => $uuid, 'values' => []];
            $this->db->put('balance', $user['id'], $row);
            foreach (self::RAILS as $rail) {
                $this->queue('balance', $user['id'], 'live', 'balance', [$rail], $uuid, 0);
            }
            return $row;
        });
    }

    public function queue(string $type, string $parent, string $env, string $action, array $methods, string $uuid, int $amount): void
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
        if ($job['type'] === 'card') {
            $this->cards->finish($job['parent'], $ok);
            return;
        }
        if ($job['type'] === 'balance') {
            $row = $this->db->get('balance', $job['parent']);
            if (!$row || (isset($row['uuid']) && $row['uuid'] !== $job['uuid'])) {
                return;
            }
            $row['values'][$job['rail']] = $ok ? $balance : null;
            $this->db->put('balance', $job['parent'], $row);
            return;
        }
        if ($job['type'] === 'order') {
            $order = $this->order($job['parent']);
            $attempt = $order['attempt'] ?? null;
            unset($order['attempt']);
            if ($ok) {
                $order['funding'][] = ['rail' => $job['rail'], 'amount' => $job['amount']];
                $this->paymentSucceeded($order);
            } else {
                if ($attempt) {
                    $this->limits->use($order['payer'], $order['env'], $job['rail'], $attempt['month'], -1);
                }
                $order['failure'] = $status;
                if ($job['rest'] && in_array($status, ['insufficient', 'unavailable', 'range'], true)) {
                    $this->advancePayment($order, $job['rest']);
                } else {
                    $this->paymentFailed($order, $status);
                }
            }
            $this->saveOrder($order);
            if (isset($order['request']) && $order['status'] !== 'processing') {
                $request = $this->db->get('request', $order['request']);
                $this->finishRequest($request, $order['status'] === 'paid', $order['failure'] ?? 'ok');
            }
            return;
        }
        $request = $this->db->get('request', $job['parent']);
        if (isset($request['order_id'])) {
            $this->finishOrderOperation($this->order($request['order_id']), $request, $ok);
        }
        if (!$ok && in_array($request['action'], ['split', 'payout'], true)) {
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

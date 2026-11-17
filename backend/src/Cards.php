<?php
declare(strict_types=1);

namespace Cashier;

final class Cards
{
    public function __construct(private readonly Clearing $clearing, private readonly array $config)
    {
    }

    private function db(): Store
    {
        return $this->clearing->db;
    }

    public function catalog(): array
    {
        return array_values(array_filter($this->db()->list('card_type'), fn ($type) => $type['active']
            && ($type['issuer'] === '' || ($this->db()->get('merchant', $type['issuer'])['state'] ?? '') === 'approved')));
    }

    public function type(array $actor, array $data): array
    {
        return $this->db()->write(function () use ($actor, $data) {
            $issuer = (string) ($data['issuer'] ?? '');
            if ($issuer === '') {
                if (!$actor['admin']) {
                    throw new Fault('仅超级管理员可发行平台卡', 403);
                }
            } else {
                $merchant = $this->clearing->manage($actor, $issuer, true);
                if ($merchant['state'] !== 'approved') {
                    throw new Fault('商户须先通过审核', 409);
                }
            }
            $id = (string) ($data['id'] ?? Config::token());
            $old = $this->db()->get('card_type', $id);
            if (!preg_match('/\A[a-f0-9]{32}\z/', $id) || ($old && $old['issuer'] !== $issuer)) {
                throw new Fault('卡种不存在或权限不足', 403);
            }
            $kinds = $data['kinds'] ?? [];
            if (!is_array($kinds) || !$kinds || array_filter($kinds, static fn ($k) => !in_array($k, ['pay', 'hold', 'agreement'], true))) {
                throw new Fault('至少选择一种支付场景');
            }
            $policy = (string) ($data['merchant_policy'] ?? 'blacklist');
            if (!in_array($policy, ['blacklist', 'whitelist'], true)) {
                throw new Fault('商户名单模式无效');
            }
            $whom = $issuer === '' ? ($data['merchants'] ?? []) : [$issuer];
            if (!is_array($whom) || count($whom) > 100) {
                throw new Fault('商户名单无效');
            }
            foreach ($whom as $idInList) {
                $this->clearing->merchant($idInList);
            }
            $images = [];
            foreach (['front', 'back'] as $side) {
                if (!empty($data[$side])) {
                    $image = $this->db()->get('card_image', Clearing::text($data, $side));
                    if (!$image || $image['owner'] !== $actor['id']) {
                        if (($old[$side] ?? null) !== $data[$side]) {
                            throw new Fault('卡面不存在或权限不足', 403);
                        }
                    }
                    $images[$side] = $data[$side];
                }
            }
            if (isset($images['back']) && !isset($images['front'])) {
                throw new Fault('自定义卡面必须上传正面');
            }
            $face = Clearing::amount($data['face'] ?? null);
            $discount = $this->rate($data, 'discount_bps', 0, 9999);
            $type = [
                'id' => $id, 'issuer' => $issuer, 'name' => Clearing::text($data, 'name', 180),
                'face' => $face, 'price' => max(1, intdiv($face * (10000 - $discount) + 9999, 10000)),
                'discount_bps' => $discount, 'single' => Limits::value($data, 'single'),
                'merchant_policy' => $issuer === '' ? $policy : 'whitelist', 'merchants' => array_values(array_unique($whom)),
                'kinds' => array_values(array_unique($kinds)), 'combine' => ($data['combine'] ?? false) === true,
                'transfer' => ($data['transfer'] ?? false) === true, 'transfer_fee' => Limits::value($data, 'transfer_fee'),
                'refund_bps' => $this->rate($data, 'refund_bps', 10000), 'refund_fee' => Limits::value($data, 'refund_fee'),
                'active' => ($data['active'] ?? true) === true,
            ] + $images;
            $this->db()->put('card_type', $id, $type, $issuer);
            return $type;
        });
    }

    public function addImage(string $owner, array $data): string
    {
        $base64 = $data['data'] ?? null;
        $bytes = is_string($base64) && strlen($base64) <= 620000 ? base64_decode($base64, true) : false;
        $info = $bytes === false ? false : @getimagesizefromstring($bytes);
        if (!$info || !in_array($info['mime'], ['image/jpeg', 'image/png', 'image/webp'], true)
            || $info[0] > 2400 || $info[1] > 2400 || $info[0] * $info[1] > 4000000) {
            throw new Fault('请上传小于 450 KiB、最长边不超过 2400 像素的 PNG、JPEG 或 WebP');
        }
        $id = Config::token();
        $row = ['owner' => $owner, 'mime' => $info['mime']];
        // Keep image contents separate from the SQL TEXT metadata, including on MySQL.
        $path = $this->imagePath($id);
        if (file_put_contents($path, $bytes, LOCK_EX) !== strlen($bytes)) {
            throw new \RuntimeException('Failed to retain card artwork');
        }
        try {
            $this->db()->write(fn () => $this->db()->put('card_image', $id, $row, $owner));
        } catch (\Throwable $e) {
            unlink($path);
            throw $e;
        }
        return $id;
    }

    public function imagePath(string $id): string
    {
        if (!preg_match('/\A[a-f0-9]{32}\z/', $id)) {
            throw new Fault('卡面不存在', 404);
        }
        return Config::runtime('card-image-' . $id);
    }

    public function buy(array $user, array $input): array
    {
        return $this->db()->write(function () use ($user, $input) {
            $typeId = Clearing::text($input, 'type');
            $rail = $this->rail($input);
            $env = $this->env($input);
            $key = $this->operationId($user, $input, 'buy');
            $old = $this->db()->get('card_operation', $key);
            if ($old) {
                if ($old['type_id'] !== $typeId || $old['env'] !== $env || $old['rail'] !== $rail) {
                    throw new Fault('请求编号已用于不同购卡参数', 409);
                }
                return $this->operationView($old);
            }
            $type = $this->db()->get('card_type', $typeId);
            if (!$type || !$type['active'] || ($type['issuer'] !== '' && $this->clearing->merchant($type['issuer'])['state'] !== 'approved')) {
                throw new Fault('该卡种未开放购买', 409);
            }
            $wallet = $this->clearing->wallet($user, $env);
            $month = Limits::month();
            $limits = new Limits($this->db());
            if (!$limits->canUse($user['id'], $env, $rail, $type['price'])) {
                throw new Fault('超出该支付方式限额', 409);
            }
            $this->issuerFunds($type, $env, $rail, -($type['face'] - $type['price']));
            $limits->use($user['id'], $env, $rail, $month, 1);
            $operation = ['id' => $key, 'user' => $user['id'], 'action' => 'buy', 'status' => 'processing',
                'type_id' => $typeId, 'terms' => $type, 'rail' => $rail, 'env' => $env, 'amount' => $type['price'], 'month' => $month];
            $this->saveOperation($operation);
            $this->clearing->queue('card', $key, $env, 'debit', [$rail], $wallet, $type['price']);
            return $operation;
        });
    }

    public function fund(array $user, array $input): array
    {
        if (!$user['admin']) {
            throw new Fault('需要超级管理员权限', 403);
        }
        return $this->db()->write(function () use ($user, $input) {
            $rail = $this->rail($input);
            $env = $this->env($input);
            $amount = Clearing::amount($input['amount'] ?? null);
            $id = $this->operationId($user, $input, 'fund');
            $old = $this->db()->get('card_operation', $id);
            if ($old) {
                if ($old['rail'] !== $rail || $old['env'] !== $env || $old['amount'] !== $amount) {
                    throw new Fault('请求编号已用于不同充值参数', 409);
                }
                return $old;
            }
            $operation = ['id' => $id, 'user' => $user['id'], 'action' => 'fund', 'status' => 'processing',
                'rail' => $rail, 'env' => $env, 'amount' => $amount];
            $this->saveOperation($operation);
            $this->clearing->queue('card', $id, $env, 'debit', [$rail], $this->clearing->wallet($user, $env), $amount);
            return $operation;
        });
    }

    public function redeem(string $owner, array $input, ?string $issuer = null, ?string $env = null): array
    {
        $number = Clearing::text($input, 'number');
        $secret = Clearing::text($input, 'secret');
        $card = $this->db()->get('card', $number);
        if (!$card || $card['state'] !== 'unclaimed' || ($env !== null && $card['env'] !== $env) || ($issuer !== null && $card['terms']['issuer'] !== $issuer)
            || !hash_equals($card['secret_hash'], $this->secretHash($number, $secret))) {
            throw new Fault('卡号或卡密无效，或卡片不可激活', 409);
        }
        $this->clearing->user($owner);
        unset($card['secret_hash']);
        $card['owner'] = $owner;
        $card['state'] = 'active';
        $this->saveCard($card);
        $this->event($card, 'activation', 0, $owner);
        return $this->view($card);
    }

    public function transfer(array $user, array $input): array
    {
        return $this->db()->write(function () use ($user, $input) {
            $card = $this->owned($user['id'], Clearing::text($input, 'number'));
            $target = $this->clearing->user(Clearing::text($input, 'user'))['id'];
            $fee = $card['terms']['transfer_fee'];
            if (!$card['terms']['transfer'] || $card['locks'] || $card['balance'] <= $fee || $target === $user['id']) {
                throw new Fault('该卡不可转让、存在未结算资金或余额不足', 409);
            }
            $card['balance'] -= $fee;
            $card['owner'] = $target;
            $this->issuerFunds($card['terms'], $card['env'], $card['rail'], $fee);
            $this->event($card, 'transfer_out', -$fee, $user['id']);
            $this->event($card, 'transfer_in', 0, $target);
            $this->saveCard($card);
            return $this->view($card);
        });
    }

    public function close(array $user, array $input): array
    {
        return $this->db()->write(function () use ($user, $input) {
            $number = Clearing::text($input, 'number');
            $id = $this->operationId($user, $input, 'return');
            $old = $this->db()->get('card_operation', $id);
            if ($old) {
                if ($old['number'] !== $number) {
                    throw new Fault('请求编号已用于其他卡片', 409);
                }
                return $old;
            }
            $card = $this->owned($user['id'], $number);
            $terms = $card['terms'];
            if ($card['locks']) {
                throw new Fault('预付卡有未结算资金', 409);
            }
            $share = intdiv($card['balance'] * $terms['price'], $terms['face']);
            $amount = max(0, intdiv($share * $terms['refund_bps'], 10000) - $terms['refund_fee']);
            $operation = ['id' => $id, 'user' => $user['id'], 'action' => 'return', 'status' => 'processing',
                'number' => $card['number'], 'rail' => $card['rail'], 'env' => $card['env'], 'amount' => $amount,
                'starting_balance' => $card['balance']];
            $card['state'] = 'returning';
            $this->saveCard($card);
            $this->saveOperation($operation);
            if ($amount === 0) {
                $this->finish($id, true);
                return $this->db()->get('card_operation', $id);
            }
            $this->clearing->queue('card', $id, $card['env'], 'credit', [$card['rail']],
                $this->clearing->wallet($user, $card['env']), $amount);
            return $operation;
        });
    }

    public function eligible(array $order, string $number, int $needed, bool $allowPartial = true): ?array
    {
        $card = $this->db()->get('card', $number);
        if (!$card || $card['owner'] !== $order['payer'] || $card['env'] !== $order['env'] || $card['state'] !== 'active') {
            return null;
        }
        $rules = $this->db()->get('card_type', $card['terms']['id']) ?? $card['terms'];
        $listed = in_array($order['merchant'], $rules['merchants'], true);
        $kind = isset($order['agreement_id']) ? 'agreement' : $order['kind'];
        if (($rules['merchant_policy'] === 'whitelist') !== $listed || !in_array($kind, $rules['kinds'], true)
            || $card['balance'] <= 0 || ($rules['single'] && min($needed, $card['balance']) > $rules['single'])
            || ($needed > $card['balance'] && (!$rules['combine'] || !$allowPartial))) {
            return null;
        }
        return $card;
    }

    public function reserve(array $card, int $amount, string $order): void
    {
        $card['balance'] -= $amount;
        $card['locks']++;
        $this->saveCard($card);
        $this->event($card, 'payment_reserved', -$amount, $card['owner'], $order);
    }

    public function settle(string $number, int $release, string $order, string $event, bool $unlock, int $used = 0): void
    {
        $card = $this->db()->get('card', $number);
        $card['balance'] += $release;
        $card['locks'] -= $unlock ? 1 : 0;
        if ($card['state'] === 'closed' && $release > 0) {
            $card['state'] = 'active';
        }
        $this->saveCard($card);
        if ($used && $release) {
            $this->event($card, 'payment_released', $release, $card['owner'], $order);
        }
        $this->event($card, $event, $used ? -$used : $release, $card['owner'], $order);
    }

    public function finish(string $id, bool $ok): void
    {
        $op = $this->db()->get('card_operation', $id);
        $op['status'] = $ok ? 'completed' : 'failed';
        if ($op['action'] === 'buy') {
            $terms = $op['terms'];
            if ($ok) {
                $number = Config::token();
                $secret = Config::token();
                $card = ['number' => $number, 'secret_hash' => $this->secretHash($number, $secret), 'owner' => null,
                    'terms' => $terms, 'env' => $op['env'], 'rail' => $op['rail'],
                    'balance' => $terms['face'], 'locks' => 0, 'state' => 'unclaimed'];
                $this->saveCard($card);
                $op['number'] = $number;
                $op['secret_box'] = $this->sealSecret($secret);
            } else {
                $this->issuerFunds($terms, $op['env'], $op['rail'], $terms['face'] - $terms['price']);
                (new Limits($this->db()))->use($op['user'], $op['env'], $op['rail'], $op['month'], -1);
            }
        } elseif ($op['action'] === 'fund') {
            if ($ok) {
                $this->issuerFunds(['issuer' => ''], $op['env'], $op['rail'], $op['amount']);
            }
        } else {
            $card = $this->db()->get('card', $op['number']);
            if ($ok) {
                $this->issuerFunds($card['terms'], $card['env'], $card['rail'], ($op['starting_balance'] ?? $card['balance']) - $op['amount']);
                $this->event($card, 'card_return', -$op['amount'], $op['user']);
                // A merchant refund arriving while the return is in flight remains redeemable.
                $card['balance'] = max(0, $card['balance'] - ($op['starting_balance'] ?? $card['balance']));
            }
            $card['state'] = $ok && $card['balance'] === 0 ? 'closed' : 'active';
            $this->saveCard($card);
        }
        $this->saveOperation($op);
    }

    public function account(string $user): array
    {
        return [
            'cards' => array_map($this->view(...), $this->db()->list('card', $user)),
            'operations' => array_map($this->operationView(...), $this->db()->list('card_operation', $user)),
            'events' => $this->events($user),
        ];
    }

    private function events(string $user): array
    {
        $events = $this->db()->list('card_event', $user);
        usort($events, static fn ($a, $b) => $b['time'] <=> $a['time']);
        return $events;
    }

    public function issuance(array $actor, string $issuer): array
    {
        if ($issuer === '' && !$actor['admin']) {
            throw new Fault('需要超级管理员权限', 403);
        }
        if ($issuer !== '') {
            $this->clearing->manage($actor, $issuer, true);
        }
        $events = $this->db()->list('issuer_card_event', $issuer);
        usort($events, static fn ($a, $b) => $b['time'] <=> $a['time']);
        return ['types' => $this->db()->list('card_type', $issuer), 'events' => $events];
    }

    private function view(array $card): array
    {
        unset($card['secret_hash']);
        return $card;
    }

    private function operationView(array $op): array
    {
        if (isset($op['secret_box']) && ($this->db()->get('card', $op['number'])['state'] ?? '') === 'unclaimed') {
            $parts = base64_decode($op['secret_box'], true);
            $op['secret'] = openssl_decrypt(substr($parts, 28), 'aes-256-gcm', $this->secretKey(), OPENSSL_RAW_DATA,
                substr($parts, 0, 12), substr($parts, 12, 16));
        }
        unset($op['secret_box']);
        return $op;
    }

    private function sealSecret(string $secret): string
    {
        $iv = random_bytes(12);
        $data = openssl_encrypt($secret, 'aes-256-gcm', $this->secretKey(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($data === false) {
            throw new \RuntimeException('Cannot encrypt card credentials');
        }
        return base64_encode($iv . $tag . $data);
    }

    private function secretKey(): string
    {
        return hash_hkdf('sha256', $this->config['keys']['private'], 32, 'cashier prepaid card credentials');
    }

    private function secretHash(string $number, string $secret): string
    {
        return hash_hmac('sha256', "$number:$secret", $this->secretKey());
    }

    private function issuerFunds(array $terms, string $env, string $rail, int $delta): void
    {
        if ($delta) {
            $this->clearing->ledger($terms['issuer'] ?: 'platform-cards', $env, $rail, $delta, 0, $delta < 0);
        }
    }

    private function owned(string $user, string $number): array
    {
        $card = $this->db()->get('card', $number);
        if (!$card || $card['owner'] !== $user || $card['state'] !== 'active') {
            throw new Fault('预付卡不可用', 404);
        }
        return $card;
    }

    private function saveCard(array $card): void
    {
        $this->db()->put('card', $card['number'], $card, $card['owner'] ?? '');
    }

    private function saveOperation(array $operation): void
    {
        $this->db()->put('card_operation', $operation['id'], $operation, $operation['user']);
    }

    private function event(array $card, string $event, int $amount, string $owner, ?string $order = null): void
    {
        $id = Config::token();
        $row = ['id' => $id, 'number' => $card['number'], 'event' => $event, 'amount' => $amount,
            'user' => $owner, 'order_id' => $order, 'time' => time(), 'env' => $card['env']];
        $this->db()->put('card_event', $id, $row, $owner);
        $this->db()->put('issuer_card_event', $id, $row, $card['terms']['issuer']);
    }

    private function operationId(array $user, array $input, string $action): string
    {
        return hash('sha256', $user['id'] . ':' . $action . ':' . Clearing::text($input, 'request_id'));
    }

    private function rail(array $input): string
    {
        $rail = Clearing::text($input, 'rail');
        if (!in_array($rail, Clearing::RAILS, true)) {
            throw new Fault('无效支付方式');
        }
        return $rail;
    }

    private function env(array $input): string
    {
        $env = $input['environment'] ?? 'live';
        if (!in_array($env, ['live', 'sandbox'], true)) {
            throw new Fault('无效交易环境');
        }
        return $env;
    }

    private function rate(array $data, string $field, int $default, int $max = 10000): int
    {
        $value = $data[$field] ?? $default;
        if (!is_int($value) || $value < 0 || $value > $max) {
            throw new Fault('费率超出范围');
        }
        return $value;
    }
}

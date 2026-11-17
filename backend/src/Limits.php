<?php
declare(strict_types=1);

namespace Cashier;

final class Limits
{
    public function __construct(private readonly Store $db)
    {
    }

    public static function value(array $data, string $key): int
    {
        return Clearing::amount($data[$key] ?? 0, true);
    }

    public function merchant(array $merchant, string $env, int $amount, ?array $exclude = null): void
    {
        $rules = $merchant['limits'] ?? [];
        $single = $rules['single'] ?? 0;
        $monthly = $rules['monthly'] ?? 0;
        $count = $rules['count'] ?? 0;
        if ($single > 0 && $amount > $single) {
            throw new Fault('超出商户单笔收款限额', 409);
        }
        if (!$monthly && !$count) {
            return;
        }
        $total = 0;
        $orders = 0;
        $month = self::month();
        foreach ($this->db->list('order', $merchant['id']) as $order) {
            if (($exclude['id'] ?? '') === $order['id'] || $order['env'] !== $env
                || $order['kind'] === 'agreement' || self::month($order['limit_time'] ?? $order['created']) !== $month
                || !in_array($order['status'], ['pending', 'processing', 'held', 'paid'], true)
                || ($order['status'] === 'pending' && ($order['expires'] ?? 0) < time())) {
                continue;
            }
            $total += $order['captured'] ?? $order['amount'];
            $orders++;
        }
        if (($monthly > 0 && $total + $amount > $monthly) || ($count > 0 && $orders >= $count)) {
            throw new Fault('商户本月收款额度或笔数已用完', 409);
        }
    }

    public function canUse(string $user, string $env, string $method, int $amount): bool
    {
        $rules = $this->db->get('payment_limit', $user . ':' . $method);
        if (!$rules) {
            return true;
        }
        $month = self::month();
        $used = $this->db->get('payment_usage', $this->usageKey($user, $env, $method, $month))['count'] ?? 0;
        if ($rules['count'] && $method !== 'card') {
            foreach ($this->db->list('player_order', $user) as $reference) {
                $order = $this->db->get('order', $reference['id']);
                if ($order && empty($order['usage_v2']) && $order['env'] === $env
                    && in_array($order['status'], ['held', 'paid'], true)
                    && $order['rail'] === $method && self::month($order['created']) === $month) {
                    $used++;
                }
            }
        }
        return (!$rules['single'] || $amount <= $rules['single']) && (!$rules['count'] || $used < $rules['count']);
    }

    public function use(string $user, string $env, string $method, string $month, int $delta): void
    {
        $key = $this->usageKey($user, $env, $method, $month);
        $count = ($this->db->get('payment_usage', $key)['count'] ?? 0) + $delta;
        if ($count < 0) {
            throw new \LogicException('Invalid usage reservation');
        }
        $this->db->put('payment_usage', $key, ['count' => $count]);
    }

    public function save(string $user, array $data): array
    {
        $method = Clearing::text($data, 'method');
        if (!in_array($method, [...Clearing::RAILS, 'card'], true)) {
            throw new Fault('无效支付方式');
        }
        $rules = ['method' => $method, 'single' => self::value($data, 'single'), 'count' => self::value($data, 'count')];
        $this->db->write(fn () => $this->db->put('payment_limit', $user . ':' . $method, $rules, $user));
        return $rules;
    }

    public static function month(?int $time = null): string
    {
        return self::local($time ?? time())->format('Y-m');
    }

    public static function due(string $rule, int $time): int
    {
        if ($rule === 'D+0') {
            return $time;
        }
        $day = self::local($time)->setTime(0, 0);
        while ((int) $day->format('N') > 5) {
            $day = $day->modify('+1 day');
        }
        for ($i = 0; $i < (int) substr($rule, 2); $i++) {
            do {
                $day = $day->modify('+1 day');
            } while ((int) $day->format('N') > 5);
        }
        return max($time, $day->getTimestamp());
    }

    private function usageKey(string $user, string $env, string $method, string $month): string
    {
        return hash('sha256', "$user:$env:$method:$month");
    }

    private static function local(int $time): \DateTimeImmutable
    {
        return (new \DateTimeImmutable('@' . $time))->setTimezone(new \DateTimeZone('Asia/Shanghai'));
    }
}

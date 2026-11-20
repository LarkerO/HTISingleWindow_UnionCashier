<?php
declare(strict_types=1);

namespace Cashier;

/** Read-only player wallet projection. Money operations remain in Clearing. */
final class Wallet
{
    public function __construct(private readonly Store $db, private readonly Clearing $clearing)
    {
    }

    public function snapshot(array $user, string $environment): array
    {
        if (!in_array($environment, ['live', 'sandbox'], true)) {
            throw new Fault('无效环境', 400, 'INVALID_ENVIRONMENT');
        }
        $identity = $this->clearing->wallet($user, $environment, false);
        $balances = [];
        $requested = null;
        if ($environment === 'sandbox') {
            foreach (Clearing::RAILS as $rail) {
                $balances[$rail] = $this->db->get('sandbox_wallet', $identity . ':' . $rail)['balance'] ?? 100000;
            }
        } elseif ($identity !== null) {
            $cached = $this->db->get('balance', $user['id']);
            if (($cached['uuid'] ?? null) === $identity) {
                $balances = $cached['values'];
                $requested = $cached['requested'];
            }
        }
        $cards = [];
        foreach ($this->db->list('card', $user['id']) as $card) {
            if ($card['env'] !== $environment || $card['state'] !== 'active') {
                continue;
            }
            $cards[] = array_intersect_key($card, array_flip(['number', 'env', 'balance', 'terms', 'state']));
        }
        return [
            'environment' => $environment, 'available' => $identity !== null,
            'balances' => (object) $balances, 'requested' => $requested,
            'complete' => count(array_intersect(Clearing::RAILS, array_keys($balances))) === count(Clearing::RAILS),
            'cards' => $cards,
        ];
    }
}

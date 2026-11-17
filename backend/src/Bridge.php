<?php
declare(strict_types=1);

namespace Cashier;

use Workerman\Connection\TcpConnection;
use Workerman\Timer;

final class Bridge
{
    /** @var array<int, array{conn: TcpConnection, nonce: string, created: int, verified: bool}> */
    private array $peers = [];
    private ?array $inflight = null;
    private int $lastHeartbeat = 0;

    public function onWorkerStart(): void
    {
        Timer::add(0.5, $this->tick(...));
    }

    public function onWebSocketConnect(TcpConnection $connection): void
    {
        $config = Config::read();
        if (!$config || empty($config['plugin_public']) || count($this->peers) >= 10) {
            $connection->close();
            return;
        }
        $nonce = Config::token();
        $this->peers[$connection->id] = ['conn' => $connection, 'nonce' => $nonce, 'created' => time(),
            'verified' => false, 'seen' => time(), 'public' => $config['plugin_public']];
        $connection->send(Config::json(['challenge' => $nonce]));
    }

    public function onClose(TcpConnection $connection): void
    {
        unset($this->peers[$connection->id]);
        if (($this->inflight['peer'] ?? null) === $connection->id) {
            $this->inflight = null;
        }
    }

    public function onMessage(TcpConnection $connection, string $raw): void
    {
        try {
            $config = Config::read();
            $peer = $this->peers[$connection->id] ?? null;
            if (!$peer || !$config || $peer['public'] !== $config['plugin_public'] || strlen($raw) > 16384) {
                $connection->close();
                return;
            }
            $data = Crypto::open($config['openssl'], Config::decode($raw), $config['keys']['private'],
                $peer['public'], 'plugin-to-backend');
            if (($data['nonce'] ?? '') !== $peer['nonce']) {
                $connection->close();
                return;
            }
            $this->peers[$connection->id]['seen'] = time();
            if (!$peer['verified']) {
                if (($data['type'] ?? '') !== 'hello') {
                    $connection->close();
                    return;
                }
                foreach ($this->peers as $id => $other) {
                    if ($id !== $connection->id && $other['verified']) {
                        $connection->close();
                        return;
                    }
                }
                $this->peers[$connection->id]['verified'] = true;
                $this->lastHeartbeat = 0;
                return;
            }
            if (($data['type'] ?? '') === 'ping') {
                return;
            }
            $clearing = new Clearing(new Store($config), $config);
            if (($data['type'] ?? '') === 'link') {
                $ok = true;
                try {
                    $clearing->bind(Clearing::text($data, 'code'), Clearing::text($data, 'uuid'), Clearing::text($data, 'name'));
                } catch (Fault) {
                    $ok = false;
                }
                $this->send($peer, $config, ['type' => 'link_result', 'uuid' => $data['uuid'], 'ok' => $ok]);
                return;
            }
            $id = $data['id'] ?? null;
            $status = $data['status'] ?? null;
            if (($data['type'] ?? '') !== 'result' || !$this->inflight || $id !== $this->inflight['id']
                || $connection->id !== $this->inflight['peer']
                || !in_array($status, ['ok', 'insufficient', 'unavailable', 'range', 'declined', 'uncertain'], true)) {
                return;
            }
            $clearing->result($id, $status, $data['balance'] ?? null);
            $this->inflight = null;
        } catch (\Throwable $e) {
            if (!$e instanceof Fault && !$e instanceof \JsonException) {
                error_log('Bridge receive failed: ' . get_class($e));
            }
            $connection->close();
        }
    }

    private function tick(): void
    {
        try {
            $config = Config::read();
            if (!$config) {
                return;
            }
            $now = time();
            $db = new Store($config);
            $clearing = new Clearing($db, $config);
            if ($job = $clearing->next('sandbox')) {
                $clearing->sandbox($job);
            }
            $active = null;
            foreach ($this->peers as $peer) {
                if ($peer['public'] !== ($config['plugin_public'] ?? null) || ($peer['seen'] < $now - 15)) {
                    $peer['conn']->close();
                } elseif ($peer['verified']) {
                    $active = $peer;
                }
            }
            if ($active && $this->lastHeartbeat < $now - 4) {
                $db->write(static fn () => $db->put('system', 'bridge', ['time' => $now]));
                $this->lastHeartbeat = $now;
            }
            if ($this->inflight && $this->inflight['retry'] <= $now) {
                $this->inflight = null;
            }
            if ($this->inflight || !($job = $clearing->next('live'))) {
                return;
            }
            if (($job['sent'] ?? $now) < $now - 180) {
                $clearing->result($job['id'], $job['action'] === 'balance' ? 'unavailable' : 'uncertain');
                return;
            }
            if (!isset($job['sent']) && $job['created'] < $now - ($job['action'] === 'balance' ? 10 : 900)) {
                $clearing->result($job['id'], 'unavailable');
                return;
            }
            if (!$active) {
                return;
            }
            if (!isset($job['sent'])) {
                $job['sent'] = $now;
                $db->write(static fn () => $db->put('job', $job['id'], $job, 'live'));
            }
            $this->inflight = ['id' => $job['id'], 'peer' => $active['conn']->id, 'retry' => $now + 15];
            $this->send($active, $config, ['type' => 'job', 'expires' => $now + 12] +
                array_intersect_key($job, array_flip(['id', 'action', 'rail', 'amount', 'uuid'])));
        } catch (\Throwable $e) {
            error_log('Bridge tick failed: ' . get_class($e));
        }
    }

    private function send(array $peer, array $config, array $data): void
    {
        $peer['conn']->send(Config::json(Crypto::seal($config['openssl'], $config['keys']['private'],
            $peer['public'], 'backend-to-plugin', $data + ['nonce' => $peer['nonce']])));
    }
}

<?php
declare(strict_types=1);

namespace Cashier;

use PDO;

final class Store
{
    private PDO $pdo;

    public function __construct(array $config)
    {
        $this->pdo = new PDO($config['dsn'], $config['db_user'] ?? null, $config['db_password'] ?? null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        if ($this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            $this->pdo->exec('PRAGMA busy_timeout = 5000');
        }
    }

    public function initialize(): void
    {
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS cashier_lock (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)');
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS cashier_records (
            bucket VARCHAR(40) NOT NULL, record_id VARCHAR(128) NOT NULL, owner_id VARCHAR(128) NOT NULL,
            content TEXT NOT NULL, PRIMARY KEY (bucket, record_id)
        )');
        $mysql = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
        try {
            $this->pdo->exec('CREATE INDEX ' . ($mysql ? '' : 'IF NOT EXISTS ') .
                'cashier_owner ON cashier_records (bucket, owner_id)');
        } catch (\PDOException $e) {
            if (!$mysql || ($e->errorInfo[1] ?? null) !== 1061) {
                throw $e;
            }
        }
        try {
            $this->pdo->exec('INSERT INTO cashier_lock (id, version) VALUES (1, 0)');
        } catch (\PDOException $e) {
            if (!$this->pdo->query('SELECT id FROM cashier_lock WHERE id = 1')->fetchColumn()) {
                throw $e;
            }
        }
    }

    public function write(callable $callback): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $this->pdo->exec('UPDATE cashier_lock SET version = 1 - version WHERE id = 1');
            $result = $callback();
            $this->pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    public function get(string $bucket, string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT content FROM cashier_records WHERE bucket = ? AND record_id = ?');
        $stmt->execute([$bucket, $id]);
        $data = $stmt->fetchColumn();
        return $data === false ? null : Config::decode($data);
    }

    public function list(string $bucket, ?string $owner = null): array
    {
        $stmt = $this->pdo->prepare('SELECT content FROM cashier_records WHERE bucket = ?' .
            ($owner === null ? '' : ' AND owner_id = ?') . ' ORDER BY record_id');
        $stmt->execute($owner === null ? [$bucket] : [$bucket, $owner]);
        return array_map(Config::decode(...), $stmt->fetchAll(PDO::FETCH_COLUMN));
    }

    public function put(string $bucket, string $id, array $data, string $owner = ''): void
    {
        $this->delete($bucket, $id);
        $stmt = $this->pdo->prepare('INSERT INTO cashier_records (bucket, record_id, owner_id, content) VALUES (?, ?, ?, ?)');
        $stmt->execute([$bucket, $id, $owner, Config::json($data)]);
    }

    public function delete(string $bucket, string $id): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM cashier_records WHERE bucket = ? AND record_id = ?');
        $stmt->execute([$bucket, $id]);
    }
}

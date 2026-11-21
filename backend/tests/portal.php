<?php
declare(strict_types=1);

use Cashier\Fault;
use Cashier\Portal;
use Cashier\Store;

require dirname(__DIR__) . '/vendor/autoload.php';

function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
if (!$socket) throw new RuntimeException($error);
$address = stream_socket_get_name($socket, false);
fclose($socket);
$log = tempnam(sys_get_temp_dir(), 'cashier-portal-');
$server = proc_open([PHP_BINARY, '-S', $address, __DIR__ . '/fixtures/portal.php'],
    [['pipe', 'r'], ['file', $log, 'a'], ['file', $log, 'a']], $pipes, __DIR__);
if (!is_resource($server)) throw new RuntimeException('Cannot start Portal fixture');
fclose($pipes[0]);
try {
    $ready = false;
    for ($i = 0; $i < 100; $i++) {
        $probe = @stream_socket_client('tcp://' . $address, $errno, $error, .1);
        if ($probe) { fclose($probe); $ready = true; break; }
        usleep(50000);
    }
    check($ready, 'Portal fixture did not start: ' . file_get_contents($log));
    $config = ['portal' => 'http://' . $address, 'origin' => 'http://cashier.example.test',
        'client_id' => 'fixture', 'client_secret' => 'fixture'];
    $uuid = 'a1234567-1111-4111-8111-123456789abc';
    foreach (['verified' => 'linked', 'bound' => 'linked', 'bound_conflict' => 'linked',
        'observed' => 'linked', 'duplicate_observations' => 'linked', 'unique_observed' => 'linked',
        'resolved_conflict' => 'linked', 'wrong_name' => 'uuid_missing',
        'primary_multiple' => 'linked', 'primary_missing' => 'uuid_missing',
        'primary_unverified' => 'unverified', 'duplicate_primary' => 'primary_required',
        'conflict' => 'uuid_conflict', 'missing' => 'uuid_missing',
        'unverified' => 'unverified', 'historical' => 'unverified', 'multiple' => 'primary_required',
        'private' => 'profile_unavailable', 'scope_missing' => 'profile_scope_missing'] as $mode => $status) {
        $user = Portal::profile($config, $mode, 'fixture-verifier');
        check($user['minecraft_status'] === $status, $mode . ': wrong sync status');
        check(($user['uuid'] ?? null) === ($status === 'linked' ? $uuid : null), $mode . ': unsafe wallet UUID');
        if ($status === 'linked') check($user['minecraft_name'] === 'FixturePlayer', $mode . ': secondary account selected');
        check($user['avatar_url'] === ($mode === 'missing' ? $config['portal'] . '/assets/public-avatar.webp'
            : 'https://cdn.example.test/avatar.webp'), $mode . ': avatar must not depend on wallet availability');
    }
    foreach (['relative' => $config['portal'] . '/assets/avatar.webp',
        'network_relative' => $config['portal'] . '/assets/public-avatar.webp',
        'fallback' => $config['portal'] . '/assets/public-avatar.webp',
        'invalid_picture' => $config['portal'] . '/assets/public-avatar.webp'] as $mode => $avatar) {
        $user = Portal::profile($config, $mode, 'fixture-verifier');
        check($user['avatar_url'] === $avatar, $mode . ': wrong avatar URL');
    }
    try {
        Portal::profile($config, 'malformed', 'fixture-verifier');
        throw new RuntimeException('Malformed accounts accepted');
    } catch (Fault $fault) {
        check($fault->status === 502, 'Malformed profile must remain an upstream failure');
    }

    $db = new Store(['dsn' => 'sqlite::memory:']);
    $db->initialize();
    $old = Portal::profile($config, 'verified', 'fixture-verifier');
    $old['avatar_url'] = 'https://cdn.example.test/previous-avatar.webp';
    Portal::saveProfile($db, $old, true);
    $db->put('balance', $old['id'], ['uuid' => $uuid, 'values' => ['vault' => 999]]);
    $current = Portal::profile($config, 'conflict', 'fixture-verifier');
    $db->write(fn () => Portal::saveProfile($db, $current));
    $saved = $db->get('user', $current['id']);
    check(!isset($saved['uuid']) && $db->get('uuid', $uuid) === null && $db->get('balance', $old['id']) === null,
        'Unavailable binding must clear the previous wallet and balance');
    check($saved['admin'] && $saved['avatar_url'] === $current['avatar_url'], 'Re-login must refresh avatar and preserve admin role');
    echo "Passed Portal OAuth/public transport, avatars, private/missing/conflicting bindings and stale wallet invalidation.\n";
} finally {
    proc_terminate($server);
    proc_close($server);
    unlink($log);
}

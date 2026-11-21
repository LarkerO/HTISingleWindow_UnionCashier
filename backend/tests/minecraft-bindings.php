<?php
declare(strict_types=1);

use Cashier\Clearing;
use Cashier\Fault;
use Cashier\Http;
use Cashier\MinecraftBindings;
use Cashier\Portal;
use Cashier\Store;

require dirname(__DIR__) . '/vendor/autoload.php';

function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}
function fails(callable $call, int $status): void
{
    try { $call(); } catch (Fault $error) { check($error->status === $status, 'Unexpected error status'); return; }
    throw new RuntimeException('Operation should have failed');
}

$db = new Store(['dsn' => 'sqlite::memory:']);
$db->initialize();
$bindings = new MinecraftBindings($db);
$clearing = new Clearing($db, ['origin' => 'http://cashier.example.test', 'keys' => ['private' => random_bytes(32)]]);
$a = 'a1234567-1111-4111-8111-123456789abc';
$b = 'b1234567-1111-4111-8111-123456789abc';
$c = 'c1234567-1111-4111-8111-123456789abc';
$d = 'd1234567-1111-4111-8111-123456789abc';
$admin = ['id' => 'admin', 'admin' => true];
$player = ['id' => 'player', 'uuid' => $a, 'minecraft_name' => 'PrimaryPlayer', 'minecraft_status' => 'linked',
    'minecraft_uuid_origin' => 'resolved', 'avatar_url' => 'https://cdn.example.test/old.webp'];
$db->write(function () use ($db, $admin, $player, $b) {
    Portal::saveProfile($db, $admin, true);
    Portal::saveProfile($db, $player);
    Portal::saveProfile($db, ['id' => 'other', 'uuid' => $b]);
});
$input = ['action' => 'bind', 'user' => 'player', 'uuid' => strtoupper(str_replace('-', '', $c)),
    'minecraft_name' => 'HelpedPlayer', 'reason' => '核对服务器资料后协助绑定'];
fails(fn () => $bindings->inspect(['id' => 'player', 'admin' => true], 'other'), 403);
fails(fn () => $bindings->change(['id' => 'player', 'admin' => true], $input), 403);
fails(fn () => $bindings->change($admin, array_replace($input, ['user' => 'unknown'])), 404);
fails(fn () => $bindings->change($admin, array_replace($input, ['uuid' => 'not-a-uuid'])), 400);
fails(fn () => $bindings->change($admin, array_replace($input, ['reason' => ' '])), 400);
fails(fn () => $bindings->change($admin, array_replace($input, ['uuid' => $b])), 409);
check($db->get('user', 'player')['uuid'] === $a && $db->get('uuid', $b)['user'] === 'other', 'Rejected change must preserve ownership');
check($db->list('minecraft_binding_event') === [], 'Rejected changes must not write audit records');
$db->put('balance', 'player', ['uuid' => $a, 'values' => ['vault' => 100]]);
$changed = $bindings->change($admin, $input);
check($changed['user']['uuid'] === $c && $changed['user']['minecraft_source'] === 'admin', 'Manual UUID and provenance');
check($clearing->wallet($db->get('user', 'player'), 'live') === $c, 'Manual binding enables the live wallet');
check($db->get('uuid', $a) === null && $db->get('balance', 'player') === null, 'Old identity index and balance cleared');
$public = (new ReflectionMethod(Http::class, 'publicUser'))->invoke(new Http(), $db->get('user', 'player'));
check($public['uuid'] === $c && !isset($public['minecraft_source']), 'Player API exposes manual wallet UUID without private source fields');

// The next OAuth login updates the automatic primary account and avatar, while the override stays active.
$newPortal = array_replace($player, ['uuid' => $d, 'minecraft_name' => 'NewPrimary', 'avatar_url' => 'https://cdn.example.test/new.webp']);
$db->write(fn () => Portal::saveProfile($db, $newPortal));
$saved = $db->get('user', 'player');
check($saved['uuid'] === $c && $saved['minecraft_name'] === 'HelpedPlayer' && $saved['minecraft_status'] === 'linked_manual', 'OAuth must preserve administrator binding');
check($saved['avatar_url'] === $newPortal['avatar_url'] && $db->get('portal_minecraft', 'player')['uuid'] === $d, 'OAuth avatar and primary account still refresh');
$db->write(fn () => Portal::saveProfile($db, ['id' => 'other', 'uuid' => $c]));
check(!isset($db->get('user', 'other')['uuid']) && $db->get('uuid', $c)['user'] === 'player', 'OAuth must never take a manually reserved UUID');
// Occupied automatic targets cannot silently replace the manual binding.
$db->write(fn () => Portal::saveProfile($db, ['id' => 'other', 'uuid' => $d]));
fails(fn () => $bindings->change($admin, ['action' => 'restore', 'user' => 'player', 'reason' => '恢复自动绑定']), 409);
check($db->get('minecraft_override', 'player')['uuid'] === $c, 'Failed restore keeps the override');
$db->write(fn () => Portal::saveProfile($db, ['id' => 'other', 'uuid' => $b]));
$restored = $bindings->change($admin, ['action' => 'restore', 'user' => 'player', 'reason' => '恢复主展示账号']);
check($restored['override'] === null && $restored['user']['uuid'] === $d && $restored['user']['minecraft_source'] === 'portal', 'Restore uses the latest Portal primary');
check($db->get('uuid', $c) === null && $db->get('uuid', $d)['user'] === 'player', 'Restore updates UUID ownership');
check(count($restored['events']) === 2 && $restored['events'][0]['actor'] === 'admin', 'Binding and restore audit records');
$bindings->change($admin, $input);
$db->write(fn () => Portal::saveProfile($db, ['id' => 'player', 'minecraft_status' => 'profile_unavailable']));
check($db->get('user', 'player')['uuid'] === $c, 'Private Portal profile does not remove an explicit administrator override');
$unlinked = $bindings->change($admin, ['action' => 'restore', 'user' => 'player', 'reason' => '交回自动管理']);
check(!isset($unlinked['user']['uuid']) && $unlinked['user']['minecraft_status'] === 'profile_unavailable', 'Restore of unavailable Portal identity clears manual UUID');
check($clearing->wallet($db->get('user', 'player'), 'live', false) === null, 'Restored unavailable identity cannot use live wallets');

// Existing held funds and agreements retain their original funding identity after an administrator change.
$bindings->change($admin, $input);
$merchant = $clearing->merchantSettings($admin, 'onboard', ['name' => '绑定回归商户']);
$merchant = $clearing->merchantSettings($admin, 'review', ['merchant' => $merchant['id'], 'state' => 'approved', 'products' => Clearing::PRODUCTS]);
$command = fn (array $body) => $clearing->command($merchant, 'live', $body, true);
$create = fn ($kind, $amount) => $command(['action' => 'create', 'request_id' => $kind, 'out_trade_no' => $kind,
    'kind' => $kind, 'amount' => $amount, 'title' => $kind])['order'];
$hold = $create('hold', 20);
$clearing->playerAction($db->get('user', 'player'), $hold['id'], 'confirm', ['vault']);
$job = $clearing->next('live');
check($job['uuid'] === $c && $job['action'] === 'debit', 'Hold uses the manual wallet');
$clearing->result($job['id'], 'ok');
$agreement = $create('agreement', 0);
$clearing->playerAction($db->get('user', 'player'), $agreement['id'], 'confirm', ['vault']);
$clearing->balance($db->get('user', 'player'));
$oldQueries = $db->list('job');
$bindings->change($admin, array_replace($input, ['uuid' => $d]));
$clearing->balance($db->get('user', 'player'));
foreach ($oldQueries as $query) $clearing->result($query['id'], 'ok', 999);
check($db->get('balance', 'player')['values'] === [], 'Delayed old-wallet balance receipts cannot populate the new wallet');
fails(fn () => $command(['action' => 'debit', 'request_id' => 'old-agreement', 'order_id' => $agreement['id'], 'amount' => 1]), 409);
$command(['action' => 'capture', 'request_id' => 'capture-old', 'order_id' => $hold['id'], 'amount' => 8]);
$credits = array_values(array_filter($db->list('job'), fn ($row) => $row['action'] === 'credit'));
check(count($credits) === 1 && $credits[0]['uuid'] === $c && $credits[0]['amount'] === 12, 'Uncaptured hold funds return to the original UUID');
$clearing->result($credits[0]['id'], 'ok');
$refund = ['action' => 'refund', 'request_id' => 'refund-old', 'order_id' => $hold['id'], 'amount' => 8];
$command($refund);
$command($refund);
$credits = array_values(array_filter($db->list('job'), fn ($row) => $row['action'] === 'credit'));
check(count($credits) === 1 && $credits[0]['uuid'] === $c && $credits[0]['amount'] === 8, 'Idempotent refund retains the original UUID');
$clearing->result($credits[0]['id'], 'ok');
echo "Passed manual UUID permissions, collisions, stale/delayed balances, OAuth persistence, restoration, audit and original-source hold/refund rules.\n";

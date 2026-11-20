<?php
declare(strict_types=1);

use Cashier\Clearing;
use Cashier\Fault;
use Cashier\Http;
use Cashier\Store;
use Cashier\Wallet;
use support\Request;

require dirname(__DIR__) . '/vendor/autoload.php';
if (!defined('BASE_PATH')) {
    define('BASE_PATH', dirname(__DIR__));
}

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$settings = ['dsn' => 'sqlite::memory:'];
$db = new Store($settings);
$db->initialize();
$clearing = new Clearing($db, $settings);
$view = new Wallet($db, $clearing);
$user = ['id' => 'mobile-player', 'minecraft_source' => 'portal', 'uuid' => 'verified-player-uuid'];
$db->put('sandbox_wallet', 'mobile-player:scoreboard', ['balance' => 0]);
$db->put('balance', $user['id'], ['uuid' => $user['uuid'], 'requested' => 100, 'values' => ['vault' => 123, 'scoreboard' => 0]]);
$card = ['number' => str_repeat('a', 32), 'env' => 'live', 'state' => 'active', 'balance' => 40,
    'secret_hash' => 'must-never-leak', 'terms' => ['name' => '交通卡', 'combine' => false]];
$db->put('card', 'live-card', $card, $user['id']);
$db->put('card', 'sandbox-card', array_replace($card, ['env' => 'sandbox']), $user['id']);
$db->put('card', 'closed-card', array_replace($card, ['state' => 'closed']), $user['id']);
$db->put('card', 'other-player-card', $card, 'another-player');

$sandbox = $view->snapshot($user, 'sandbox');
check($sandbox['balances']->vault === 100000 && $sandbox['balances']->scoreboard === 0, 'Sandbox defaults and zero balance');
check($sandbox['complete'] && count($sandbox['cards']) === 1 && $sandbox['cards'][0]['env'] === 'sandbox', 'Sandbox card isolation');
$live = $view->snapshot($user, 'live');
check($live['balances']->vault === 123 && $live['balances']->scoreboard === 0 && $live['complete'], 'Real cached game balance');
check(count($live['cards']) === 1 && !isset($live['cards'][0]['secret_hash']), 'Card owner, state and secret filtering');
check(!isset($live['uuid']), 'Private wallet identity is not exposed');
$db->put('balance', $user['id'], ['uuid' => 'previous-binding', 'requested' => 100, 'values' => ['vault' => 999]]);
check(!$view->snapshot($user, 'live')['complete'], 'Old Minecraft binding cannot supply wallet balance');
check(!$view->snapshot(['id' => $user['id']], 'live')['available'], 'Unverified player cannot use live game wallets');
try {
    $view->snapshot($user, 'invalid');
    throw new RuntimeException('Invalid environment accepted');
} catch (Fault $fault) {
    check($fault->errorCode() === 'INVALID_ENVIRONMENT', 'Stable environment error code');
}

$id = str_repeat('a', 32);
$request = new Request("GET /checkout/$id HTTP/1.1\r\nHost: localhost\r\nUser-Agent: iPhone Mobile\r\n\r\n");
$response = (new Http())->page($request, $id);
check($response->getHeader('Location') === '/mobile/checkout/' . $id, 'Mobile UA uses separate checkout');
check($db->list('job') === [], 'Wallet projection queues no money or balance operations');
echo "Passed mobile wallet isolation, private fields, stale bindings and checkout UA redirect.\n";

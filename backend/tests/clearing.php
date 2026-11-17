<?php
declare(strict_types=1);

use Cashier\Clearing;
use Cashier\Config;
use Cashier\Fault;
use Cashier\Limits;
use Cashier\Portal;
use Cashier\Statements;
use Cashier\Store;

require dirname(__DIR__) . '/vendor/autoload.php';

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function rejects(callable $call): void
{
    try {
        $call();
    } catch (Fault) {
        return;
    }
    throw new RuntimeException('Expected request to be rejected');
}

if (!is_dir(Config::runtime())) {
    mkdir(Config::runtime(), 0700, true);
}
$settings = ['dsn' => 'sqlite::memory:', 'origin' => 'http://localhost:8787',
    'keys' => ['private' => random_bytes(32)]];
$db = new Store($settings);
$db->initialize();
$clearing = new Clearing($db, $settings);
$admin = ['id' => 'admin', 'admin' => true, 'uuid' => '12345678-1111-4111-8111-123456789abc'];
$buyer = ['id' => 'buyer', 'admin' => false, 'uuid' => '12345678-2222-4222-8222-123456789abc'];
$recipient = ['id' => 'recipient', 'admin' => false, 'uuid' => '12345678-3333-4333-8333-123456789abc'];
$db->write(function () use ($db, $admin, $buyer, $recipient) {
    Portal::saveProfile($db, $admin, true);
    Portal::saveProfile($db, $buyer);
    Portal::saveProfile($db, $recipient);
    $db->put('system', 'admin', ['id' => $admin['id']]);
});
$merchant = $clearing->merchantSettings($admin, 'onboard', ['name' => '轨道交通']);
$merchant = $clearing->merchantSettings($admin, 'review',
    ['merchant' => $merchant['id'], 'state' => 'approved', 'products' => Clearing::PRODUCTS]);
$other = $clearing->merchantSettings($admin, 'onboard', ['name' => '公交']);
$drain = static function () use ($clearing): void {
    while ($job = $clearing->next('sandbox')) {
        $clearing->sandbox($job);
    }
};
$command = static fn (array $input, string $env = 'sandbox') => $clearing->command($merchant, $env, $input, true);
$create = static fn (string $kind, string $code, int $amount, string $env = 'sandbox') => $command(
    ['action' => 'create', 'kind' => $kind, 'request_id' => $code, 'amount' => $amount, 'out_trade_no' => $code, 'title' => $code], $env)['order'];
$type = $clearing->cards->type($admin, ['issuer' => '', 'name' => '交通卡', 'face' => 100, 'kinds' => ['pay', 'hold', 'agreement'],
    'combine' => true, 'transfer' => true, 'transfer_fee' => 3, 'refund_bps' => 9000, 'refund_fee' => 2,
    'merchant_policy' => 'whitelist', 'merchants' => [$merchant['id']]]);
$purchase = ['request_id' => 'buy', 'type' => $type['id'], 'environment' => 'sandbox', 'rail' => 'vault'];
$clearing->cards->buy($buyer, $purchase);
$drain();
$op = $clearing->cards->buy($buyer, $purchase);
expect($op['status'] === 'completed' && strlen($op['secret']) === 32, 'Purchase credentials');
$card = $db->write(fn () => $clearing->cards->redeem('buyer', $op));
$number = $card['number'];
rejects(fn () => $db->write(fn () => $clearing->cards->redeem('recipient', $op)));
expect(!isset($clearing->cards->buy($buyer, $purchase)['secret']), 'PIN must disappear after activation');

$hold = $create('hold', 'hold', 120);
$clearing->cards->type($admin, ['merchants' => [$other['id']]] + $type);
expect($clearing->paymentCards($clearing->user('buyer'), $hold) === [], 'Updated allowlist prevents use of already issued card');
$clearing->cards->type($admin, $type);
expect(count($clearing->paymentCards($clearing->user('buyer'), $hold)) === 1, 'Restoring merchant eligibility affects existing card');
$clearing->playerAction($buyer, $hold['id'], 'confirm', ['card:' . $number, 'scoreboard']);
$drain();
expect($clearing->order($hold['id'])['status'] === 'held', 'Combined preauthorization');
$command(['action' => 'capture', 'request_id' => 'capture', 'order_id' => $hold['id'], 'amount' => 80]);
$drain();
expect($clearing->order($hold['id'])['captured'] === 80 && $db->get('card', $number)['balance'] === 20, 'Partial capture');
expect($db->get('sandbox_wallet', 'buyer:scoreboard')['balance'] === 100000, 'Unused game leg restored');
$command(['action' => 'refund', 'request_id' => 'refund', 'order_id' => $hold['id'], 'amount' => 30]);
expect($db->get('card', $number)['balance'] === 50, 'Card refund returned to original funding instrument');
$clearing->cards->transfer($buyer, ['number' => $number, 'user' => 'recipient']);
expect($db->get('card', $number)['balance'] === 47, 'Transfer fee');
$close = $clearing->cards->close($recipient, ['number' => $number, 'request_id' => 'close']);
$drain();
expect($close['amount'] === 40 && $db->get('card', $number)['state'] === 'closed', 'Card return refund');
expect($db->get('sandbox_wallet','recipient:vault')['balance'] === 100040, 'Return paid to recipient');
expect($db->get('ledger',$merchant['id'] . ':sandbox:vault')['balance'] === 50, 'Card settlement backed by original rail');

$storeCard = $clearing->cards->type($admin, ['issuer' => $merchant['id'], 'name' => '商户专用卡',
    'face' => 100, 'kinds' => ['pay', 'agreement'], 'combine' => true, 'discount_bps' => 1000]);
$offer = ['request_id' => 'discount', 'type' => $storeCard['id'], 'environment' => 'sandbox', 'rail' => 'vault'];
$clearing->cards->buy($buyer, $offer);
$drain();
$ticket = $clearing->cards->buy($buyer, $offer);
expect($ticket['amount'] === 90 && $db->get('ledger', $merchant['id'] . ':sandbox:vault')['balance'] === 40,
    'Discount funded by merchant rather than creating money');
rejects(fn () => $clearing->command($other, 'sandbox',
    ['action' => 'card_bind', 'request_id' => 'bind-other', 'user' => 'buyer', 'number' => $ticket['number'], 'secret' => $ticket['secret']], true));
rejects(fn () => $command(
    ['action' => 'card_bind', 'request_id' => 'bind-live', 'user' => 'buyer', 'number' => $ticket['number'], 'secret' => $ticket['secret']], 'live'));
$bind = ['action' => 'card_bind', 'request_id' => 'bind-own', 'user' => 'buyer', 'number' => $ticket['number'], 'secret' => $ticket['secret']];
expect($command($bind)['request']['card']['number'] === $ticket['number'] &&
    $command($bind)['request']['card']['number'] === $ticket['number'], 'Merchant binding is scoped and idempotent');
$cardMethod = 'card:' . $ticket['number'];
$tooLarge = $create('pay', 'too-large', 300000);
$clearing->playerAction($buyer, $tooLarge['id'], 'confirm', [$cardMethod, 'vault', 'scoreboard']);
$drain();
expect($clearing->order($tooLarge['id'])['status'] === 'failed'
    && $db->get('card', $ticket['number'])['balance'] === 100, 'Failed mixed payment releases card reservation');
$agreement = $create('agreement', 'agreement', 0);
$clearing->playerAction($buyer, $agreement['id'], 'confirm', [$cardMethod, 'vault']);
$debit = $command(['action' => 'debit', 'request_id' => 'debit-card', 'order_id' => $agreement['id'], 'amount' => 15]);
expect($debit['request']['status'] === 'completed' && $db->get('card', $ticket['number'])['balance'] === 85,
    'Agreement can charge the selected prepaid card');
$clearing->playerAction($buyer, $agreement['id'], 'revoke');
rejects(fn () => $command(['action' => 'debit', 'request_id' => 'revoked', 'order_id' => $agreement['id'], 'amount' => 1]));

$clearing->limits->save('buyer', ['method' => 'scoreboard', 'single' => 10, 'count' => 2]);
$one = $create('pay', 'one', 10);
$clearing->playerAction($buyer, $one['id'], 'confirm', ['scoreboard']);
$drain();
expect($clearing->order($one['id'])['status'] === 'paid', 'Payment within monthly quota');
$two = $create('pay', 'two', 10);
rejects(fn () => $clearing->playerAction($buyer, $two['id'], 'confirm', ['scoreboard']));
expect($clearing->order($two['id'])['status'] === 'pending', 'Rejected options leave the checkout reusable');
$clearing->merchantSettings($admin, 'settlement',
    ['merchant' => $merchant['id'], 'cycle' => 'T+2', 'single' => 60, 'monthly' => 100, 'count' => 2]);
rejects(fn () => $create('pay', 'oversized', 70, 'live'));
$paid = $create('pay', 'live-payment', 50, 'live');
$clearing->playerAction($buyer, $paid['id'], 'confirm', ['vault']);
$job = $clearing->next('live');
$clearing->result($job['id'], 'ok');
$clearing->result($job['id'], 'ok');
$ledger = $db->get('ledger', $merchant['id'] . ':live:vault');
expect($ledger['balance'] === 50 && $clearing->available($merchant['id'], $ledger) === 0, 'T+2 funds unavailable and receipts deduplicated');
rejects(fn () => $command(['action' => 'payout', 'request_id' => 'payout', 'user' => 'recipient', 'rail' => 'vault', 'amount' => 1], 'live'));
$command(['action' => 'refund', 'request_id' => 'live-refund', 'order_id' => $paid['id'], 'amount' => 5], 'live');
$clearing->result($clearing->next('live')['id'], 'ok');
$ledger = $db->get('ledger', $merchant['id'] . ':live:vault');
expect($ledger['balance'] === 45 && $clearing->available($merchant['id'], $ledger) === 0, 'Unsettled refund preserved correct available balance');
$rows = $command(['action' => 'statement', 'month' => Limits::month()], 'live');
expect($rows['total'] === 2 && array_sum(array_column($rows['items'], 'amount')) === 45, 'Merchant reconciliation');
expect($clearing->statements->read('buyer', $other['id'], ['environment' => 'live'])['total'] === 0, 'Player statement merchant scoping');
if (isset($argv[1])) {
    file_put_contents($argv[1], Statements::xlsx($rows['items']));
}
echo "Passed prepaid purchase, activation, combined hold, refunds, transfer, return, quotas, T+2 and reconciliation.\n";

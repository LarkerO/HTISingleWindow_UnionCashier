<?php
declare(strict_types=1);

umask(0077);
require __DIR__ . '/vendor/autoload.php';
Workerman\Worker::$logFile = Cashier\Config::runtime('logs/bridge.log');
support\App::loadAllConfig(['route', 'container']);
worker_start('cashier-bridge', config('process.cashier-bridge'));
Workerman\Worker::runAll();

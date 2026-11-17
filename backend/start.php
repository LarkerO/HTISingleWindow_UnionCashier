<?php
declare(strict_types=1);

umask(0077);
ini_set('display_errors', '0');
require __DIR__ . '/vendor/autoload.php';

foreach (['logs', 'sessions'] as $directory) {
    $path = Cashier\Config::runtime($directory);
    if (!is_dir($path) && !@mkdir($path, 0700, true) && !is_dir($path)) {
        throw new RuntimeException('Cannot create ' . $path);
    }
}

if (($argv[1] ?? '') === 'setup-token') {
    if (is_file(Cashier\Config::path())) {
        exit("Installation already completed.\n");
    }
    $token = Cashier\Config::token();
    $path = Cashier\Config::runtime('setup.hash');
    if (file_put_contents($path, openssl_digest($token, 'sm3'), LOCK_EX) === false) {
        throw new RuntimeException('Cannot save setup token');
    }
    echo $token . PHP_EOL;
    exit;
}

if (DIRECTORY_SEPARATOR === '\\') {
    // Workerman starts the separate files as child processes on Windows.
    if (!in_array(__DIR__ . DIRECTORY_SEPARATOR . 'bridge.php', $argv, true) && !in_array('-q', $argv, true)) {
        $argv[] = __DIR__ . DIRECTORY_SEPARATOR . 'bridge.php';
        $_SERVER['argv'] = $argv;
    }
    Workerman\Worker::$logFile = Cashier\Config::runtime('logs/workerman.log');
    support\App::loadAllConfig(['route', 'container']);
    worker_start('webman', config('process.webman'));
    Workerman\Worker::runAll();
} else {
    support\App::run();
}

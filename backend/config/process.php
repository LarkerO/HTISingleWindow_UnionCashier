<?php
declare(strict_types=1);

return [
    'webman' => [
        'handler' => Webman\App::class,
        'listen' => 'http://' . (getenv('CASHIER_HTTP_LISTEN') ?: '127.0.0.1:8787'),
        'count' => 1,
        'constructor' => [
            'requestClass' => support\Request::class,
            'logger' => support\Log::channel('default'),
            'appPath' => BASE_PATH . '/src',
            'publicPath' => BASE_PATH . '/public',
        ],
    ],
    'cashier-bridge' => [
        'handler' => Cashier\Bridge::class,
        'listen' => 'websocket://' . (getenv('CASHIER_WS_LISTEN') ?: '127.0.0.1:8788'),
        'count' => 1,
    ],
];

<?php
declare(strict_types=1);

return [
    'debug' => false,
    'default_timezone' => 'Asia/Shanghai',
    'request_class' => support\Request::class,
    'public_path' => BASE_PATH . '/public',
    'runtime_path' => \Cashier\Config::runtime(),
    'controller_suffix' => '',
    'controller_reuse' => false,
];

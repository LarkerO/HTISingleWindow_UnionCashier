<?php
return [
    'default' => [
        'handlers' => [[
            'class' => Monolog\Handler\StreamHandler::class,
            'constructor' => [\Cashier\Config::runtime('logs/app.log'), Monolog\Level::Info],
        ]],
    ],
];

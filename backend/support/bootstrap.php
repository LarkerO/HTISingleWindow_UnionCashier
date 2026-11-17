<?php
require __DIR__ . '/../vendor/workerman/webman-framework/src/support/bootstrap.php';

\Workerman\Protocols\Http\Session::$name = 'HTISWSESSID';
\Workerman\Protocols\Http\Session::$sameSite = 'Lax';
\Workerman\Protocols\Http\Session::$cookieLifetime = 0;
\Workerman\Protocols\Http\Session::$lifetime = 3600;
\Workerman\Protocols\Http\Session\FileSessionHandler::sessionSavePath(\Cashier\Config::runtime('sessions'));
\Workerman\Protocols\Http\Session::handlerClass(\Cashier\Sessions::class);

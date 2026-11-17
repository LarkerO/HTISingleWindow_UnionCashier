<?php
return [
    'pid_file' => \Cashier\Config::runtime('webman.pid'),
    'status_file' => \Cashier\Config::runtime('webman.status'),
    'stdout_file' => \Cashier\Config::runtime('logs/stdout.log'),
    'log_file' => \Cashier\Config::runtime('logs/workerman.log'),
    'max_package_size' => 1048576,
];

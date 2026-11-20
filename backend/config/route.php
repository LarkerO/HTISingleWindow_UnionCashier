<?php
use Webman\Route;
use Cashier\Http;

Route::disableDefaultRoute();
Route::any('/api/{path:.+}', [Http::class, 'api']);
Route::get('/oauth/login', [Http::class, 'login']);
Route::get('/oauth/callback', [Http::class, 'callback']);
Route::post('/open/v1', [Http::class, 'merchant']);
Route::get('/', [Http::class, 'page']);
Route::get('/install', [Http::class, 'page']);
Route::get('/checkout/{id:[a-f0-9]{32}}', [Http::class, 'page']);
Route::get('/mobile', [Http::class, 'mobile']);
Route::get('/mobile/', [Http::class, 'mobile']);
Route::get('/mobile/checkout/{id:[a-f0-9]{32}}', [Http::class, 'mobile']);
Route::get('/docs', [Http::class, 'documentation']);
Route::get('/docs/{operation:[a-z-]+}', [Http::class, 'documentation']);

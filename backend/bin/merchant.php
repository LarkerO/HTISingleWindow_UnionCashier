<?php
declare(strict_types=1);

use Cashier\Config;
use Cashier\Crypto;

require dirname(__DIR__) . '/vendor/autoload.php';

if ($argc !== 8) {
    fwrite(STDERR, "Usage: php backend/bin/merchant.php ORIGIN MERCHANT_ID KEY_ID PRIVATE_PEM PLATFORM_PEM sandbox|live REQUEST_JSON\n");
    exit(1);
}

[, $origin, $merchant, $keyId, $privatePath, $platformPath, $env, $inputPath] = $argv;
umask(0077);
if (!is_dir(\Cashier\Config::runtime())) {
    mkdir(\Cashier\Config::runtime(), 0700);
}

try {
    $bin = getenv('CASHIER_OPENSSL') ?: 'openssl';
    $private = (string) file_get_contents($privatePath);
    $platform = (string) file_get_contents($platformPath);
    $request = [
        'merchant' => $merchant, 'key_id' => $keyId, 'environment' => $env,
        'challenge' => Config::token(), 'timestamp' => time(),
    ] + Config::decode((string) file_get_contents($inputPath));
    $body = Crypto::seal($bin, $private, $platform, 'merchant-request', $request);
    $curl = curl_init(Config::url($origin, true) . '/open/v1');
    curl_setopt_array($curl, [
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => Config::json($body),
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Merchant-Id: ' . $merchant, 'X-Key-Id: ' . $keyId],
    ]);
    $raw = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    if (!is_string($raw)) {
        throw new RuntimeException('Network request failed');
    }
    $envelope = Config::decode($raw);
    if (!isset($envelope['signature'])) {
        $code = $envelope['code'] ?? 'UNKNOWN_ERROR';
        throw new RuntimeException('No signed response (HTTP ' . $status . ', ' . $code . '): ' . ($envelope['error'] ?? 'unknown error'));
    }
    $response = Crypto::open($bin, $envelope, $private, $platform, 'merchant-response');
    foreach (['merchant', 'key_id', 'environment', 'challenge', 'request_id'] as $name) {
        if (($response[$name] ?? null) !== ($request[$name] ?? null)) {
            throw new RuntimeException('Response does not match request: ' . $name);
        }
    }
    if (!is_int($response['timestamp'] ?? null) || abs(time() - $response['timestamp']) > 300) {
        throw new RuntimeException('Expired response');
    }
    echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
    exit($response['ok'] ? 0 : 2);
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit(1);
}

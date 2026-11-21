<?php
declare(strict_types=1);

// Local OAuth/public API fixture. Never loaded by the application.
header('Content-Type: application/json');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/api/oauth/token') {
    echo json_encode(['access_token' => $_POST['code'] ?? 'verified']);
    return;
}
if ($path === '/api/oauth/userinfo') {
    $mode = substr($_SERVER['HTTP_AUTHORIZATION'] ?? '', strlen('Bearer '));
    $picture = match ($mode) {
        'fallback', 'missing' => null,
        'relative' => 'assets/avatar.webp',
        'network_relative' => '//cdn.example.test/avatar.webp',
        'invalid_picture' => 'javascript:alert(1)',
        default => 'https://cdn.example.test/avatar.webp',
    };
    echo json_encode(['sub' => 'portal-subject', 'hydroline_id' => 'H-FIXTURE', 'name' => 'Portal User',
        'preferred_username' => $mode === 'scope_missing' ? null : $mode, 'picture' => $picture]);
    return;
}
if (!preg_match('~^/api/public/users/([^/]+)(/minecraft-accounts)?$~', $path, $match)) {
    http_response_code(404);
    echo '{}';
    return;
}
$mode = $match[1];
if ($mode === 'private') {
    http_response_code(404);
    echo json_encode(['data' => ['code' => 'MINECRAFT_PROFILE_NOT_PUBLIC']]);
    return;
}
if (!isset($match[2])) {
    echo json_encode(['profile' => ['avatarUrl' => '/assets/public-avatar.webp']]);
    return;
}
$account = ['identityKind' => 'AUTHENTICATED', 'status' => 'VERIFIED', 'isPrimary' => true,
    'username' => 'FixturePlayer', 'uuid' => 'A1234567111141118111123456789ABC',
    'serverViews' => [str_repeat('x', 70000)]];
if (in_array($mode, ['observed', 'conflict', 'resolved_conflict', 'duplicate_observations', 'unique_observed',
    'wrong_name', 'missing', 'bound', 'bound_conflict', 'primary_multiple', 'primary_missing'], true)) {
    $account['uuid'] = null;
    $account['playerIdentity'] = ['boundUuid' => null,
        'resolvedUuid' => in_array($mode, ['missing', 'conflict', 'unique_observed', 'wrong_name', 'primary_missing'], true)
            ? null : 'a1234567-1111-4111-8111-123456789abc',
        'observedUuidCount' => in_array($mode, ['conflict', 'duplicate_observations'], true) ? 4 : 1,
        'hasUuidConflict' => in_array($mode, ['conflict', 'duplicate_observations', 'bound_conflict'], true)];
    if ($mode === 'conflict' || $mode === 'resolved_conflict') {
        $account['playerIdentity']['observedPlayers'] = [
            ['uuid' => 'a1234567-1111-4111-8111-123456789abc', 'username' => 'FixturePlayer'],
            ['uuid' => 'b1234567-1111-4111-8111-123456789abc', 'username' => 'FixturePlayer'],
        ];
    } elseif (in_array($mode, ['duplicate_observations', 'unique_observed', 'wrong_name'], true)) {
        $account['playerIdentity']['observedPlayers'] = array_fill(0, 4, ['uuid' => 'A1234567111141118111123456789ABC',
            'username' => $mode === 'wrong_name' ? 'OtherPlayer' : 'fixtureplayer']);
    }
    if ($mode === 'bound' || $mode === 'bound_conflict') {
        $account['uuid'] = 'invalid';
        $account['playerIdentity']['boundUuid'] = ' A1234567111141118111123456789ABC ';
    }
}
if ($mode === 'unverified') $account['status'] = 'IMPORTED';
if ($mode === 'historical') $account['identityKind'] = 'HISTORICAL';
if ($mode === 'primary_unverified') $account['status'] = 'IMPORTED';
$accounts = [$account];
if (in_array($mode, ['primary_multiple', 'primary_missing', 'primary_unverified', 'duplicate_primary'], true)) {
    $secondary = array_replace($account, ['uuid' => 'b1234567111141118111123456789abc',
        'username' => 'SecondaryPlayer', 'status' => 'VERIFIED', 'isPrimary' => $mode === 'duplicate_primary']);
    $accounts = [$secondary, $account];
}
if ($mode === 'multiple') {
    $account['isPrimary'] = false;
    $accounts = [$account, array_replace($account, ['uuid' => 'b1234567111141118111123456789abc'])];
}
echo json_encode($mode === 'malformed' ? ['accounts' => null] : ['accounts' => $accounts]);

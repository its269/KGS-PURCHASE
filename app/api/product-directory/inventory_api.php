<?php
/**
 * Standalone Product Inventory HTTP API.
 *
 * Deploy BOTH files to the PHP server (same folder):
 *   - inventory_api.php          (this file)
 *   - inventory_welcome.php      (endpoint implementation)
 *
 * Public URL:
 *   http://190.92.233.232/HRISAPI/inventory_api.php/inventory_browse
 *
 * Env on the server (never hardcode secrets in this file):
 *   MYSQL_HOST=127.0.0.1
 *   MYSQL_PORT=3306
 *   MYSQL_USER=...
 *   MYSQL_PASSWORD=...
 *   MYSQL_INVENTORY_DATABASE=db_kelin_inventory
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Cookie, X-Inventory-Admin-Token, session_token, X-Session-Id');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/inventory_welcome.php';

$raw = file_get_contents('php://input');
$body = json_decode($raw ?: '{}', true);
if (!is_array($body)) {
    $body = [];
}
$GLOBALS['__inventory_api_body'] = $body;

$action = '';
if (!empty($_GET['action'])) {
    $action = trim((string) $_GET['action']);
}
if ($action === '' && !empty($_SERVER['PATH_INFO'])) {
    $action = trim((string) basename($_SERVER['PATH_INFO']));
}
if ($action === '' && !empty($_SERVER['REQUEST_URI'])) {
    $uriPath = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (is_string($uriPath)) {
        $base = basename($uriPath);
        if ($base !== 'inventory_api.php') {
            $action = trim($base);
        }
    }
}
if ($action === '' && !empty($body['action'])) {
    $action = trim((string) $body['action']);
}

$actionKey = preg_replace('/[^a-z0-9_]/', '', strtolower($action));

if ($actionKey === 'health' || $actionKey === 'inventory_health') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['status' => 'success', 'success' => true, 'data' => ['ok' => true]]);
    exit;
}

$map = [
    'browse' => 'browse',
    'inventory_browse' => 'browse',
    'search' => 'search',
    'inventory_search' => 'search',
    'product' => 'product',
    'inventory_product' => 'product',
    'folder_create' => 'folderCreate',
    'inventory_folder_create' => 'folderCreate',
    'product_create' => 'productCreate',
    'inventory_product_create' => 'productCreate',
    'folder_delete' => 'folderDelete',
    'inventory_folder_delete' => 'folderDelete',
    'product_delete' => 'productDelete',
    'inventory_product_delete' => 'productDelete',
];

if ($actionKey === '' || !isset($map[$actionKey])) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'status' => 'error',
        'message' => 'Unknown action. Example: /HRISAPI/inventory_api.php/inventory_browse',
    ]);
    exit;
}

$method = $map[$actionKey];
InventoryWelcomeEndpoints::$method();

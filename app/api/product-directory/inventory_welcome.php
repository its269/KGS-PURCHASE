<?php
/**
 * Product Inventory endpoints for CI3 Welcome controller.
 *
 * Wire into Welcome.php (or include this file's methods).
 *
 * Read (SELECT only on inventory_items):
 *   POST /Welcome/inventory_browse
 *   POST /Welcome/inventory_search
 *   POST /Welcome/inventory_product
 *
 * Admin (NEW tables only — never UPDATE inventory_items):
 *   POST /Welcome/inventory_folder_create
 *   POST /Welcome/inventory_product_create
 *   POST /Welcome/inventory_folder_delete
 *   POST /Welcome/inventory_product_delete
 *
 * Env (do not hardcode secrets):
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD
 *   MYSQL_INVENTORY_DATABASE (default db_kelin_inventory)
 *   INVENTORY_ADMIN_TOKEN (optional; if set, admin routes need header X-Inventory-Admin-Token)
 *
 * SQL bootstrap: scripts/sql/inventory_custom_tables.sql
 */

class InventoryWelcomeEndpoints
{
    private const ROOT_ID = 'kg-posting';
    private const ROOT_NAME = 'KG Posting Class';

    private static $postingFolders = [
        'machine' => ['name' => 'Machine', 'code' => 'MCHPRINTER'],
        'inks'    => ['name' => 'Inks',    'code' => 'INKS'],
        'media'   => ['name' => 'Media',   'code' => 'CONSUMABLE'],
        'tools'   => ['name' => 'Tools',   'code' => 'ACCSSORIES'],
    ];

    private static $itemClassLabels = [
        'ECOEPSON'   => 'Eco Solvent',
        'ECOSOLVENT' => 'Eco Solvent',
        'SOLVENTPR'  => 'Solvent',
        'SOLVENT'    => 'Solvent',
        'SUBLIMTION' => 'Sublimation',
        'UVPRINTER'  => 'UV Printer',
        'FLATBEDCUT' => 'Flatbed Cutter',
        'FLATBED CU' => 'Flatbed Cutter',
        'LASERMACH'  => 'Laser Machine',
        'HEATPRESS'  => 'Heat Press',
        'HEAT PRESS' => 'Heat Press',
        'CUTTERPLOT' => 'Cutter Plotter',
        'PRINTHEAD'  => 'Printhead',
        'LAMINATOR'  => 'Laminator',
        'ACCSSORIES' => 'Accessories',
        'TARPAULIN'  => 'Tarpaulin',
        'VINYLSTIC'  => 'Vinyl Sticker',
        'LABEL'      => 'Label',
        'PVCBOARD'   => 'PVC Board',
        'ACRYLIC'    => 'Acrylic',
        'TEXTILE'    => 'Textile',
        'DISPLAY'    => 'Display',
    ];

    /** Call from Welcome::inventory_browse() */
    public static function browse()
    {
        $body = self::readJson();
        $folderId = isset($body['folder_id']) ? trim((string) $body['folder_id']) : '';
        try {
            $db = self::db();
            self::ensureTables($db);
            $data = self::doBrowse($db, $folderId);
            self::ok($data);
        } catch (Exception $e) {
            self::fail(500, $e->getMessage());
        }
    }

    public static function search()
    {
        $body = self::readJson();
        $query = isset($body['query']) ? trim((string) $body['query']) : '';
        $limit = isset($body['limit']) ? (int) $body['limit'] : 40;
        if ($limit < 1) {
            $limit = 40;
        }
        if ($limit > 200) {
            $limit = 200;
        }
        try {
            $db = self::db();
            self::ensureTables($db);
            $data = self::doSearch($db, $query, $limit);
            self::ok($data);
        } catch (Exception $e) {
            self::fail(500, $e->getMessage());
        }
    }

    public static function product()
    {
        $body = self::readJson();
        $productId = isset($body['product_id']) ? trim((string) $body['product_id']) : '';
        if ($productId === '') {
            self::fail(400, 'product_id is required');
            return;
        }
        try {
            $db = self::db();
            self::ensureTables($db);
            $product = self::getProduct($db, $productId);
            if ($product === null) {
                self::fail(404, 'Product not found');
                return;
            }
            self::ok($product);
        } catch (Exception $e) {
            self::fail(500, $e->getMessage());
        }
    }

    public static function folderCreate()
    {
        if (!self::requireAdmin()) {
            return;
        }
        $body = self::readJson();
        try {
            $db = self::db();
            self::ensureTables($db);
            self::ok(self::createFolder($db, $body));
        } catch (InvalidArgumentException $e) {
            self::fail(400, $e->getMessage());
        } catch (Exception $e) {
            self::fail(500, $e->getMessage());
        }
    }

    public static function productCreate()
    {
        if (!self::requireAdmin()) {
            return;
        }
        $body = self::readJson();
        try {
            $db = self::db();
            self::ensureTables($db);
            self::ok(self::createProduct($db, $body));
        } catch (InvalidArgumentException $e) {
            self::fail(400, $e->getMessage());
        } catch (Exception $e) {
            self::fail(500, $e->getMessage());
        }
    }

    public static function folderDelete()
    {
        if (!self::requireAdmin()) {
            return;
        }
        $body = self::readJson();
        $folderId = isset($body['folder_id']) ? trim((string) $body['folder_id']) : '';
        if ($folderId === '' || strpos($folderId, 'custom_') !== 0) {
            self::fail(400, 'Only custom folders can be deleted');
            return;
        }
        try {
            $db = self::db();
            self::ensureTables($db);
            self::softDeleteFolder($db, $folderId);
            self::ok(['deleted' => true]);
        } catch (Exception $e) {
            self::fail(500, $e->getMessage());
        }
    }

    public static function productDelete()
    {
        if (!self::requireAdmin()) {
            return;
        }
        $body = self::readJson();
        $productId = isset($body['product_id']) ? trim((string) $body['product_id']) : '';
        if ($productId === '' || strpos($productId, 'custom_') !== 0) {
            self::fail(400, 'Only custom products can be deleted');
            return;
        }
        try {
            $db = self::db();
            self::ensureTables($db);
            self::softDeleteProduct($db, $productId);
            self::ok(['deleted' => true]);
        } catch (Exception $e) {
            self::fail(500, $e->getMessage());
        }
    }

    // -------------------------------------------------------------------------

    private static function db()
    {
        $host = getenv('MYSQL_HOST') ?: '127.0.0.1';
        $port = (int) (getenv('MYSQL_PORT') ?: 3306);
        $user = getenv('MYSQL_USER') ?: '';
        $pass = getenv('MYSQL_PASSWORD') ?: '';
        $name = getenv('MYSQL_INVENTORY_DATABASE') ?: 'db_kelin_inventory';
        if ($user === '' || $pass === '') {
            throw new RuntimeException('MYSQL_USER / MYSQL_PASSWORD env not set');
        }
        $mysqli = @new mysqli($host, $user, $pass, $name, $port);
        if ($mysqli->connect_errno) {
            throw new RuntimeException('DB connect failed: ' . $mysqli->connect_error);
        }
        $mysqli->set_charset('utf8mb4');
        return $mysqli;
    }

    private static function ensureTables(mysqli $db)
    {
        $db->query(
            "CREATE TABLE IF NOT EXISTS inventory_custom_folders (
              id VARCHAR(64) NOT NULL PRIMARY KEY,
              name VARCHAR(255) NOT NULL,
              parent_id VARCHAR(64) NULL,
              kind VARCHAR(32) NOT NULL DEFAULT 'subcategory',
              path_json JSON NULL,
              child_count INT NOT NULL DEFAULT 0,
              created_by VARCHAR(128) NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              deleted_at TIMESTAMP NULL DEFAULT NULL,
              KEY idx_parent (parent_id),
              KEY idx_deleted (deleted_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
        $db->query(
            "CREATE TABLE IF NOT EXISTS inventory_custom_products (
              id VARCHAR(64) NOT NULL PRIMARY KEY,
              name VARCHAR(512) NOT NULL,
              sku VARCHAR(128) NOT NULL,
              description TEXT NULL,
              folder_id VARCHAR(64) NOT NULL,
              folder_path_json JSON NULL,
              created_by VARCHAR(128) NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              deleted_at TIMESTAMP NULL DEFAULT NULL,
              KEY idx_folder (folder_id),
              KEY idx_sku (sku),
              KEY idx_deleted (deleted_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    }

    private static function labelForItemClass($code)
    {
        if ($code === null || $code === '') {
            return 'Other';
        }
        $key = trim((string) $code);
        if (isset(self::$itemClassLabels[$key])) {
            return self::$itemClassLabels[$key];
        }
        return ucwords(strtolower(str_replace('_', ' ', $key)));
    }

    private static function folderIdFor($parent, $itemClass)
    {
        $raw = strtolower(trim((string) ($itemClass ?: 'other')));
        $raw = str_replace(' ', '-', $raw);
        $safe = preg_replace('/[^a-z0-9_-]+/', '-', $raw);
        return $parent . '__' . $safe;
    }

    private static function parsePath($json)
    {
        if ($json === null || $json === '') {
            return [];
        }
        $decoded = json_decode($json, true);
        if (!is_array($decoded)) {
            return [];
        }
        return array_map('strval', $decoded);
    }

    private static function customFolders(mysqli $db, $parentId)
    {
        $sql = "SELECT id, name, parent_id, kind, path_json, child_count
                FROM inventory_custom_folders
                WHERE deleted_at IS NULL AND parent_id <=> ?
                ORDER BY name";
        $stmt = $db->prepare($sql);
        $stmt->bind_param('s', $parentId);
        $stmt->execute();
        $res = $stmt->get_result();
        $out = [];
        while ($row = $res->fetch_assoc()) {
            $out[] = [
                'id'          => $row['id'],
                'name'        => $row['name'],
                'parent_id'   => $row['parent_id'],
                'kind'        => $row['kind'] ?: 'subcategory',
                'child_count' => (int) $row['child_count'],
                'path'        => self::parsePath($row['path_json']),
            ];
        }
        $stmt->close();
        return $out;
    }

    private static function customProducts(mysqli $db, $folderId)
    {
        $sql = "SELECT id, name, sku, description, folder_id, folder_path_json
                FROM inventory_custom_products
                WHERE deleted_at IS NULL AND folder_id = ?
                ORDER BY name";
        $stmt = $db->prepare($sql);
        $stmt->bind_param('s', $folderId);
        $stmt->execute();
        $res = $stmt->get_result();
        $out = [];
        while ($row = $res->fetch_assoc()) {
            $out[] = [
                'id'          => $row['id'],
                'name'        => $row['name'],
                'sku'         => $row['sku'],
                'description' => $row['description'] ?: '',
                'folder_id'   => $row['folder_id'],
                'folder_path' => self::parsePath($row['folder_path_json']),
            ];
        }
        $stmt->close();
        return $out;
    }

    private static function doBrowse(mysqli $db, $folderId)
    {
        $current = ($folderId === '' || $folderId === 'root') ? self::ROOT_ID : $folderId;

        if ($current === self::ROOT_ID) {
            $folders = [];
            foreach (self::$postingFolders as $fid => $meta) {
                $code = $meta['code'];
                $stmt = $db->prepare(
                    "SELECT COUNT(DISTINCT item_class) AS c FROM inventory_items
                     WHERE deleted_at IS NULL AND item_status='Active' AND company_id='main'
                       AND posting_class=?"
                );
                $stmt->bind_param('s', $code);
                $stmt->execute();
                $native = (int) ($stmt->get_result()->fetch_assoc()['c'] ?? 0);
                $stmt->close();
                $custom = self::customFolders($db, $fid);
                $folders[] = [
                    'id'          => $fid,
                    'name'        => $meta['name'],
                    'parent_id'   => self::ROOT_ID,
                    'kind'        => 'category',
                    'child_count' => $native + count($custom),
                    'path'        => [self::ROOT_NAME, $meta['name']],
                ];
            }
            $folders = array_merge($folders, self::customFolders($db, self::ROOT_ID));
            return [
                'folders'  => $folders,
                'products' => self::customProducts($db, self::ROOT_ID),
            ];
        }

        if (isset(self::$postingFolders[$current])) {
            $meta = self::$postingFolders[$current];
            $code = $meta['code'];
            $stmt = $db->prepare(
                "SELECT item_class, COUNT(DISTINCT inventory_id) AS c
                 FROM inventory_items
                 WHERE deleted_at IS NULL AND item_status='Active' AND company_id='main'
                   AND posting_class=?
                 GROUP BY item_class
                 ORDER BY c DESC, item_class ASC"
            );
            $stmt->bind_param('s', $code);
            $stmt->execute();
            $res = $stmt->get_result();
            $folders = [];
            while ($row = $res->fetch_assoc()) {
                $ic = $row['item_class'];
                $subName = self::labelForItemClass($ic);
                $folders[] = [
                    'id'          => self::folderIdFor($current, $ic),
                    'name'        => $subName,
                    'parent_id'   => $current,
                    'kind'        => 'subcategory',
                    'child_count' => (int) $row['c'],
                    'path'        => [self::ROOT_NAME, $meta['name'], $subName],
                ];
            }
            $stmt->close();
            $folders = array_merge($folders, self::customFolders($db, $current));
            return [
                'folders'  => $folders,
                'products' => self::customProducts($db, $current),
            ];
        }

        if (preg_match('/^([a-z]+)__(.+)$/', $current, $m) && isset(self::$postingFolders[$m[1]])) {
            $parent = $m[1];
            $meta = self::$postingFolders[$parent];
            $code = $meta['code'];
            $stmt = $db->prepare(
                "SELECT DISTINCT item_class FROM inventory_items
                 WHERE deleted_at IS NULL AND item_status='Active' AND company_id='main'
                   AND posting_class=?"
            );
            $stmt->bind_param('s', $code);
            $stmt->execute();
            $res = $stmt->get_result();
            $matched = null;
            while ($row = $res->fetch_assoc()) {
                $ic = trim((string) $row['item_class']);
                if (self::folderIdFor($parent, $ic) === $current) {
                    $matched = $ic;
                    break;
                }
            }
            $stmt->close();
            $products = [];
            if ($matched !== null) {
                $subName = self::labelForItemClass($matched);
                $stmt = $db->prepare(
                    "SELECT inventory_id, inventory_name, type
                     FROM inventory_items
                     WHERE deleted_at IS NULL AND item_status='Active' AND company_id='main'
                       AND posting_class=? AND item_class=?
                     GROUP BY inventory_id, inventory_name, type
                     ORDER BY inventory_name
                     LIMIT 2000"
                );
                $stmt->bind_param('ss', $code, $matched);
                $stmt->execute();
                $res = $stmt->get_result();
                while ($row = $res->fetch_assoc()) {
                    $desc = $meta['name'] . ' · ' . $subName;
                    if (!empty($row['type'])) {
                        $desc .= ' · ' . $row['type'];
                    }
                    $products[] = [
                        'id'          => $row['inventory_id'],
                        'name'        => $row['inventory_name'] ?: $row['inventory_id'],
                        'sku'         => $row['inventory_id'],
                        'description' => $desc,
                        'folder_id'   => $current,
                        'folder_path' => [self::ROOT_NAME, $meta['name'], $subName],
                    ];
                }
                $stmt->close();
            }
            $products = array_merge($products, self::customProducts($db, $current));
            return [
                'folders'  => self::customFolders($db, $current),
                'products' => $products,
            ];
        }

        return [
            'folders'  => self::customFolders($db, $current),
            'products' => self::customProducts($db, $current),
        ];
    }

    private static function doSearch(mysqli $db, $query, $limit)
    {
        if ($query === '') {
            return ['folders' => [], 'products' => []];
        }
        $like = '%' . $query . '%';
        $stmt = $db->prepare(
            "SELECT inventory_id, inventory_name, item_class, posting_class, type
             FROM inventory_items
             WHERE deleted_at IS NULL AND item_status='Active' AND company_id='main'
               AND posting_class IN ('MCHPRINTER','INKS','CONSUMABLE','ACCSSORIES')
               AND (inventory_name LIKE ? OR inventory_id LIKE ? OR item_class LIKE ?)
             GROUP BY inventory_id, inventory_name, item_class, posting_class, type
             ORDER BY inventory_name
             LIMIT ?"
        );
        $stmt->bind_param('sssi', $like, $like, $like, $limit);
        $stmt->execute();
        $res = $stmt->get_result();
        $products = [];
        $folderHits = [];
        $codeToId = [];
        $codeToName = [];
        foreach (self::$postingFolders as $fid => $meta) {
            $codeToId[$meta['code']] = $fid;
            $codeToName[$meta['code']] = $meta['name'];
        }
        $qLower = strtolower($query);
        while ($row = $res->fetch_assoc()) {
            $pc = $row['posting_class'];
            $pid = isset($codeToId[$pc]) ? $codeToId[$pc] : 'machine';
            $pname = isset($codeToName[$pc]) ? $codeToName[$pc] : $pc;
            $subName = self::labelForItemClass($row['item_class']);
            $subId = self::folderIdFor($pid, $row['item_class']);
            $products[] = [
                'id'          => $row['inventory_id'],
                'name'        => $row['inventory_name'] ?: $row['inventory_id'],
                'sku'         => $row['inventory_id'],
                'description' => $pname . ' · ' . $subName,
                'folder_id'   => $subId,
                'folder_path' => [self::ROOT_NAME, $pname, $subName],
            ];
            if (!isset($folderHits[$subId]) && strpos(strtolower($subName), $qLower) !== false) {
                $folderHits[$subId] = [
                    'id' => $subId, 'name' => $subName, 'parent_id' => $pid,
                    'kind' => 'subcategory', 'child_count' => null,
                    'path' => [self::ROOT_NAME, $pname, $subName],
                ];
            }
            if (!isset($folderHits[$pid]) && strpos(strtolower($pname), $qLower) !== false) {
                $folderHits[$pid] = [
                    'id' => $pid, 'name' => $pname, 'parent_id' => self::ROOT_ID,
                    'kind' => 'category', 'child_count' => null,
                    'path' => [self::ROOT_NAME, $pname],
                ];
            }
        }
        $stmt->close();

        $stmt = $db->prepare(
            "SELECT id, name, parent_id, kind, path_json, child_count
             FROM inventory_custom_folders
             WHERE deleted_at IS NULL AND name LIKE ?
             ORDER BY name LIMIT ?"
        );
        $stmt->bind_param('si', $like, $limit);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $folderHits[$row['id']] = [
                'id' => $row['id'], 'name' => $row['name'], 'parent_id' => $row['parent_id'],
                'kind' => $row['kind'] ?: 'subcategory', 'child_count' => (int) $row['child_count'],
                'path' => self::parsePath($row['path_json']),
            ];
        }
        $stmt->close();

        $stmt = $db->prepare(
            "SELECT id, name, sku, description, folder_id, folder_path_json
             FROM inventory_custom_products
             WHERE deleted_at IS NULL AND (name LIKE ? OR sku LIKE ? OR description LIKE ?)
             ORDER BY name LIMIT ?"
        );
        $stmt->bind_param('sssi', $like, $like, $like, $limit);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $products[] = [
                'id' => $row['id'], 'name' => $row['name'], 'sku' => $row['sku'],
                'description' => $row['description'] ?: '', 'folder_id' => $row['folder_id'],
                'folder_path' => self::parsePath($row['folder_path_json']),
            ];
        }
        $stmt->close();

        $folders = array_values($folderHits);
        $folders = array_slice($folders, 0, $limit);
        $remaining = max(0, $limit - count($folders));
        return [
            'folders'  => $folders,
            'products' => array_slice($products, 0, $remaining),
        ];
    }

    private static function getProduct(mysqli $db, $productId)
    {
        $stmt = $db->prepare(
            "SELECT id, name, sku, description, folder_id, folder_path_json
             FROM inventory_custom_products
             WHERE deleted_at IS NULL AND id=? LIMIT 1"
        );
        $stmt->bind_param('s', $productId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if ($row) {
            return [
                'id' => $row['id'], 'name' => $row['name'], 'sku' => $row['sku'],
                'description' => $row['description'] ?: '', 'folder_id' => $row['folder_id'],
                'folder_path' => self::parsePath($row['folder_path_json']),
            ];
        }

        $stmt = $db->prepare(
            "SELECT inventory_id, inventory_name, item_class, posting_class, type
             FROM inventory_items
             WHERE deleted_at IS NULL AND item_status='Active' AND company_id='main'
               AND inventory_id=? LIMIT 1"
        );
        $stmt->bind_param('s', $productId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$row) {
            return null;
        }
        $codeToId = [];
        $codeToName = [];
        foreach (self::$postingFolders as $fid => $meta) {
            $codeToId[$meta['code']] = $fid;
            $codeToName[$meta['code']] = $meta['name'];
        }
        $pc = $row['posting_class'];
        $pid = isset($codeToId[$pc]) ? $codeToId[$pc] : 'machine';
        $pname = isset($codeToName[$pc]) ? $codeToName[$pc] : 'Machine';
        $subName = self::labelForItemClass($row['item_class']);
        return [
            'id' => $row['inventory_id'],
            'name' => $row['inventory_name'] ?: $row['inventory_id'],
            'sku' => $row['inventory_id'],
            'description' => $pname . ' · ' . $subName,
            'folder_id' => self::folderIdFor($pid, $row['item_class']),
            'folder_path' => [self::ROOT_NAME, $pname, $subName],
        ];
    }

    private static function createFolder(mysqli $db, array $body)
    {
        $name = isset($body['name']) ? trim((string) $body['name']) : '';
        if ($name === '') {
            throw new InvalidArgumentException('Folder name is required');
        }
        $parentId = isset($body['parent_id']) ? trim((string) $body['parent_id']) : self::ROOT_ID;
        if ($parentId === '') {
            $parentId = self::ROOT_ID;
        }
        $kind = isset($body['kind']) ? trim((string) $body['kind']) : 'subcategory';
        $parentPath = isset($body['parent_path']) && is_array($body['parent_path'])
            ? $body['parent_path']
            : [self::ROOT_NAME];
        $id = isset($body['id']) && $body['id'] !== ''
            ? (string) $body['id']
            : ('custom_' . bin2hex(random_bytes(6)));
        $path = array_values(array_merge($parentPath, [$name]));
        $pathJson = json_encode($path);
        $createdBy = isset($body['created_by']) ? substr((string) $body['created_by'], 0, 128) : '';
        $stmt = $db->prepare(
            "INSERT INTO inventory_custom_folders
             (id, name, parent_id, kind, path_json, child_count, created_by)
             VALUES (?,?,?,?,?,0,?)"
        );
        $stmt->bind_param('ssssss', $id, $name, $parentId, $kind, $pathJson, $createdBy);
        if (!$stmt->execute()) {
            throw new RuntimeException($stmt->error);
        }
        $stmt->close();
        return [
            'id' => $id, 'name' => $name, 'parent_id' => $parentId,
            'kind' => $kind, 'child_count' => 0, 'path' => $path,
        ];
    }

    private static function createProduct(mysqli $db, array $body)
    {
        $name = isset($body['name']) ? trim((string) $body['name']) : '';
        if ($name === '') {
            throw new InvalidArgumentException('Product name is required');
        }
        $folderId = isset($body['folder_id']) ? trim((string) $body['folder_id']) : self::ROOT_ID;
        if ($folderId === '') {
            $folderId = self::ROOT_ID;
        }
        $id = isset($body['id']) && $body['id'] !== ''
            ? (string) $body['id']
            : ('custom_prod_' . bin2hex(random_bytes(6)));
        $sku = isset($body['sku']) ? trim((string) $body['sku']) : '';
        if ($sku === '') {
            $sku = $id;
        }
        $description = isset($body['description']) ? trim((string) $body['description']) : '';
        $folderPath = isset($body['folder_path']) && is_array($body['folder_path'])
            ? $body['folder_path']
            : [self::ROOT_NAME];
        $pathJson = json_encode(array_values($folderPath));
        $createdBy = isset($body['created_by']) ? substr((string) $body['created_by'], 0, 128) : '';
        $stmt = $db->prepare(
            "INSERT INTO inventory_custom_products
             (id, name, sku, description, folder_id, folder_path_json, created_by)
             VALUES (?,?,?,?,?,?,?)"
        );
        $stmt->bind_param(
            'sssssss',
            $id,
            $name,
            $sku,
            $description,
            $folderId,
            $pathJson,
            $createdBy
        );
        if (!$stmt->execute()) {
            throw new RuntimeException($stmt->error);
        }
        $stmt->close();
        return [
            'id' => $id, 'name' => $name, 'sku' => $sku, 'description' => $description,
            'folder_id' => $folderId, 'folder_path' => array_values($folderPath),
        ];
    }

    private static function softDeleteFolder(mysqli $db, $folderId)
    {
        $stmt = $db->prepare(
            "UPDATE inventory_custom_folders SET deleted_at=NOW()
             WHERE id=? AND deleted_at IS NULL"
        );
        $stmt->bind_param('s', $folderId);
        $stmt->execute();
        $stmt->close();
        // Cascade soft-delete children
        do {
            $db->query(
                "UPDATE inventory_custom_folders child
                 JOIN inventory_custom_folders parent ON child.parent_id = parent.id
                 SET child.deleted_at = NOW()
                 WHERE parent.deleted_at IS NOT NULL AND child.deleted_at IS NULL"
            );
            $changed = $db->affected_rows > 0;
        } while ($changed);
        $db->query(
            "UPDATE inventory_custom_products p
             JOIN inventory_custom_folders f ON p.folder_id = f.id
             SET p.deleted_at = NOW()
             WHERE f.deleted_at IS NOT NULL AND p.deleted_at IS NULL"
        );
        $stmt = $db->prepare(
            "UPDATE inventory_custom_products SET deleted_at=NOW()
             WHERE folder_id=? AND deleted_at IS NULL"
        );
        $stmt->bind_param('s', $folderId);
        $stmt->execute();
        $stmt->close();
    }

    private static function softDeleteProduct(mysqli $db, $productId)
    {
        $stmt = $db->prepare(
            "UPDATE inventory_custom_products SET deleted_at=NOW()
             WHERE id=? AND deleted_at IS NULL"
        );
        $stmt->bind_param('s', $productId);
        $stmt->execute();
        $stmt->close();
    }

    private static function requireAdmin()
    {
        $token = getenv('INVENTORY_ADMIN_TOKEN') ?: '';
        if ($token === '') {
            return true;
        }
        $header = isset($_SERVER['HTTP_X_INVENTORY_ADMIN_TOKEN'])
            ? $_SERVER['HTTP_X_INVENTORY_ADMIN_TOKEN']
            : '';
        if (!hash_equals($token, $header)) {
            self::fail(403, 'Admin token required');
            return false;
        }
        return true;
    }

    private static function readJson()
    {
        // Prefer body stashed by inventory_api.php front controller (php://input is one-shot).
        if (isset($GLOBALS['__inventory_api_body']) && is_array($GLOBALS['__inventory_api_body'])) {
            return $GLOBALS['__inventory_api_body'];
        }
        $raw = file_get_contents('php://input');
        $data = json_decode($raw ?: '{}', true);
        return is_array($data) ? $data : [];
    }

    private static function ok($data)
    {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'status'  => 'success',
            'success' => true,
            'data'    => $data,
        ]);
    }

    private static function fail($code, $message)
    {
        http_response_code((int) $code);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'status'  => 'error',
            'message' => $message,
        ]);
    }
}

/*
 * Drop-in Welcome methods (copy into Welcome.php):
 *
 * public function inventory_browse() { InventoryWelcomeEndpoints::browse(); }
 * public function inventory_search() { InventoryWelcomeEndpoints::search(); }
 * public function inventory_product() { InventoryWelcomeEndpoints::product(); }
 * public function inventory_folder_create() { InventoryWelcomeEndpoints::folderCreate(); }
 * public function inventory_product_create() { InventoryWelcomeEndpoints::productCreate(); }
 * public function inventory_folder_delete() { InventoryWelcomeEndpoints::folderDelete(); }
 * public function inventory_product_delete() { InventoryWelcomeEndpoints::productDelete(); }
 */

/**
 * Product Directory API — KC CMS hierarchy.
 * Ported from inventory_kc_cms.php / inventory_welcome.php / inventory_live_api.py.
 *
 * Hierarchy: Product Directory → KC Category → KC Item Class → folders → products
 * (Does not browse Acumatica inventory_items for folder trees.)
 *
 * Env:
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD
 *   MYSQL_INVENTORY_DATABASE (default db_kelin_inventory)
 *   INVENTORY_ADMIN_TOKEN (optional; admin mutations need X-Inventory-Admin-Token)
 */
import crypto from "crypto";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import mysql from "mysql2/promise";

export const ROOT_ID = "kg-posting";
export const ROOT_NAME = "Product Directory";

const ALLOWED_ACTIONS = new Set(["opened_product", "searched", "downloaded"]);

export type FolderKind = "category" | "subcategory" | "folder" | string;

export interface FolderNode {
    id: string;
    name: string;
    parent_id: string | null;
    kind: FolderKind;
    child_count: number | null;
    path: string[];
}

export interface ProductNode {
    id: string;
    name: string;
    sku: string;
    description: string;
    file_url: string;
    folder_id: string;
    folder_path: string[];
}

export interface BrowseResult {
    folders: FolderNode[];
    products: ProductNode[];
}

type JsonBody = Record<string, unknown>;

interface CategoryRow extends RowDataPacket {
    id: string;
    name: string;
}

interface ItemClassRow extends RowDataPacket {
    id: string;
    category_id: string;
    name: string;
    category_name?: string;
}

interface FolderRow extends RowDataPacket {
    id: string;
    item_class_id: string;
    parent_id: string | null;
    name: string;
    kind: string;
}

interface ProductRow extends RowDataPacket {
    id: string;
    folder_id: string;
    name: string;
    sku: string;
    description: string | null;
    file_url: string | null;
}

interface CountRow extends RowDataPacket {
    c: number;
}

interface ActionLogRow extends RowDataPacket {
    id: string;
    action: string;
    actor_id: string;
    actor_name: string;
    target_id: string;
    target_name: string;
    detail: string | null;
    created_at: Date | string | null;
}

let pool: Pool | null = null;

function httpError(message: string, status: number): Error & { status: number } {
    const err = new Error(message) as Error & { status: number };
    err.status = status;
    return err;
}

function getPool(): Pool {
    if (pool) return pool;
    const user = process.env.MYSQL_USER || "";
    const password = process.env.MYSQL_PASSWORD || "";
    if (!user || !password) {
        throw new Error("MYSQL_USER / MYSQL_PASSWORD env not set");
    }
    pool = mysql.createPool({
        host: process.env.MYSQL_HOST || "127.0.0.1",
        port: parseInt(process.env.MYSQL_PORT || "3306", 10),
        user,
        password,
        database: process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory",
        waitForConnections: true,
        connectionLimit: 5,
        charset: "utf8mb4",
    });
    return pool;
}

function newId(prefix: string, bytes = 6): string {
    return `${prefix}${crypto.randomBytes(bytes).toString("hex")}`;
}

async function ensureKcTables(): Promise<void> {
    const db = getPool();
    await db.query(`
        CREATE TABLE IF NOT EXISTS kc_categories (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_active_sort (is_active, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS kc_item_classes (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          category_id VARCHAR(64) NOT NULL,
          name VARCHAR(255) NOT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_category (category_id),
          KEY idx_active_sort (is_active, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS kc_folders (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          item_class_id VARCHAR(64) NOT NULL,
          parent_id VARCHAR(64) NULL,
          name VARCHAR(255) NOT NULL,
          kind VARCHAR(32) NOT NULL DEFAULT 'folder',
          sort_order INT NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_item_class (item_class_id),
          KEY idx_parent (parent_id),
          KEY idx_active_sort (is_active, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS kc_products (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          folder_id VARCHAR(64) NOT NULL,
          name VARCHAR(512) NOT NULL,
          sku VARCHAR(128) NOT NULL DEFAULT '',
          description TEXT NULL,
          file_url VARCHAR(1024) NULL,
          sort_order INT NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_folder (folder_id),
          KEY idx_sku (sku),
          KEY idx_active_sort (is_active, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await seedIfEmpty();
}

async function ensureActionLogsTable(): Promise<void> {
    const db = getPool();
    await db.query(`
        CREATE TABLE IF NOT EXISTS inventory_action_logs (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          action VARCHAR(32) NOT NULL,
          actor_id VARCHAR(128) NOT NULL DEFAULT '',
          actor_name VARCHAR(255) NOT NULL DEFAULT '',
          target_id VARCHAR(64) NOT NULL DEFAULT '',
          target_name VARCHAR(512) NOT NULL DEFAULT '',
          detail TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_created (created_at),
          KEY idx_action (action),
          KEY idx_actor (actor_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function ensureTables(): Promise<void> {
    await ensureKcTables();
    await ensureActionLogsTable();
}

async function seedIfEmpty(): Promise<void> {
    const db = getPool();
    const [rows] = await db.query<CountRow[]>("SELECT COUNT(*) AS c FROM kc_categories");
    if (Number(rows[0]?.c || 0) > 0) return;

    const categories: [string, string, number][] = [
        ["machine", "Machine", 1],
        ["inks", "Inks", 2],
        ["media", "Media", 3],
        ["tools", "Tools", 4],
    ];
    for (const [id, name, sort] of categories) {
        await db.query(
            "INSERT INTO kc_categories (id, name, sort_order, is_active) VALUES (?,?,?,1)",
            [id, name, sort]
        );
    }

    const icId = "kc_ic_eco_solvent";
    await db.query(
        "INSERT INTO kc_item_classes (id, category_id, name, sort_order, is_active) VALUES (?,?,?,1,1)",
        [icId, "machine", "Eco Solvent"]
    );

    const folders: [string, string, number][] = [
        ["kc_fld_brochure", "Brochure", 1],
        ["kc_fld_inks", "Inks", 2],
        ["kc_fld_machines", "Machines", 3],
        ["kc_fld_images", "Images", 4],
        ["kc_fld_other", "Other folder", 5],
    ];
    for (const [id, name, sort] of folders) {
        await db.query(
            `INSERT INTO kc_folders (id, item_class_id, parent_id, name, kind, sort_order, is_active)
             VALUES (?,?,NULL,?,'folder',?,1)`,
            [id, icId, name, sort]
        );
    }

    await db.query(
        `INSERT INTO kc_folders (id, item_class_id, parent_id, name, kind, sort_order, is_active)
         VALUES (?,?,?,?,'folder',1,1)`,
        ["kc_fld_models", icId, "kc_fld_machines", "Different Model"]
    );

    const samples: [string, string, string, string, string][] = [
        ["kc_prd_brochure_1", "kc_fld_brochure", "Eco Solvent Brochure A", "BR-ECO-A", "Different type of brochure for Eco Solvent"],
        ["kc_prd_ink_1", "kc_fld_inks", "Eco Solvent Ink Set", "INK-ECO-1", "Different type of Inks for Eco Solvent"],
        ["kc_prd_machine_1", "kc_fld_machines", "Eco Solvent Printer Sample", "MCH-ECO-1", "Different type of machines for Eco Solvent"],
        ["kc_prd_model_1", "kc_fld_models", "Organized Model Sample", "MDL-ECO-1", "Organized Model of machines"],
        ["kc_prd_image_1", "kc_fld_images", "Sample Image Pack", "IMG-ECO-1", "FOLDER OF IMAGES"],
    ];
    for (const [id, folderId, name, sku, description] of samples) {
        await db.query(
            `INSERT INTO kc_products (id, folder_id, name, sku, description, sort_order, is_active)
             VALUES (?,?,?,?,?,1,1)`,
            [id, folderId, name, sku, description]
        );
    }
}

async function getCategory(id: string): Promise<CategoryRow | null> {
    const db = getPool();
    const [rows] = await db.query<CategoryRow[]>(
        "SELECT id, name FROM kc_categories WHERE id=? LIMIT 1",
        [id]
    );
    return rows[0] || null;
}

async function getItemClass(id: string): Promise<ItemClassRow | null> {
    const db = getPool();
    const [rows] = await db.query<ItemClassRow[]>(
        "SELECT id, category_id, name FROM kc_item_classes WHERE id=? LIMIT 1",
        [id]
    );
    return rows[0] || null;
}

async function getFolder(id: string): Promise<FolderRow | null> {
    const db = getPool();
    const [rows] = await db.query<FolderRow[]>(
        "SELECT id, item_class_id, parent_id, name, kind FROM kc_folders WHERE id=? LIMIT 1",
        [id]
    );
    return rows[0] || null;
}

async function isCategory(id: string): Promise<boolean> {
    const db = getPool();
    const [rows] = await db.query<RowDataPacket[]>(
        "SELECT id FROM kc_categories WHERE id=? AND is_active=1 LIMIT 1",
        [id]
    );
    return rows.length > 0;
}

async function isItemClass(id: string): Promise<boolean> {
    const db = getPool();
    const [rows] = await db.query<RowDataPacket[]>(
        "SELECT id FROM kc_item_classes WHERE id=? AND is_active=1 LIMIT 1",
        [id]
    );
    return rows.length > 0;
}

async function isFolder(id: string): Promise<boolean> {
    const db = getPool();
    const [rows] = await db.query<RowDataPacket[]>(
        "SELECT id FROM kc_folders WHERE id=? AND is_active=1 LIMIT 1",
        [id]
    );
    return rows.length > 0;
}

async function folderPath(folder: FolderRow): Promise<string[]> {
    const ic = await getItemClass(folder.item_class_id);
    const cat = ic ? await getCategory(ic.category_id) : null;
    const names = [ROOT_NAME];
    if (cat) names.push(cat.name);
    if (ic) names.push(ic.name);

    const chain: string[] = [];
    let current: FolderRow | null = folder;
    let guard = 0;
    while (current && guard < 20) {
        chain.unshift(current.name);
        if (!current.parent_id) break;
        current = await getFolder(current.parent_id);
        guard += 1;
    }
    return [...names, ...chain];
}

async function listCategories(): Promise<FolderNode[]> {
    const db = getPool();
    const [rows] = await db.query<CategoryRow[]>(
        "SELECT id, name FROM kc_categories WHERE is_active=1 ORDER BY sort_order, name"
    );
    const out: FolderNode[] = [];
    for (const row of rows) {
        const [countRows] = await db.query<CountRow[]>(
            "SELECT COUNT(*) AS c FROM kc_item_classes WHERE is_active=1 AND category_id=?",
            [row.id]
        );
        out.push({
            id: row.id,
            name: row.name,
            parent_id: ROOT_ID,
            kind: "category",
            child_count: Number(countRows[0]?.c || 0),
            path: [ROOT_NAME, row.name],
        });
    }
    return out;
}

async function listItemClasses(categoryId: string, categoryName: string): Promise<FolderNode[]> {
    const db = getPool();
    const [rows] = await db.query<CategoryRow[]>(
        `SELECT id, name FROM kc_item_classes
         WHERE is_active=1 AND category_id=? ORDER BY sort_order, name`,
        [categoryId]
    );
    const out: FolderNode[] = [];
    for (const row of rows) {
        const [countRows] = await db.query<CountRow[]>(
            `SELECT COUNT(*) AS c FROM kc_folders
             WHERE is_active=1 AND item_class_id=? AND parent_id IS NULL`,
            [row.id]
        );
        out.push({
            id: row.id,
            name: row.name,
            parent_id: categoryId,
            kind: "subcategory",
            child_count: Number(countRows[0]?.c || 0),
            path: [ROOT_NAME, categoryName, row.name],
        });
    }
    return out;
}

async function listFolders(
    itemClassId: string,
    parentId: string | null,
    parentPath: string[]
): Promise<FolderNode[]> {
    const db = getPool();
    const [rows] =
        parentId == null
            ? await db.query<FolderRow[]>(
                  `SELECT id, name, kind, item_class_id, parent_id FROM kc_folders
                   WHERE is_active=1 AND item_class_id=? AND parent_id IS NULL
                   ORDER BY sort_order, name`,
                  [itemClassId]
              )
            : await db.query<FolderRow[]>(
                  `SELECT id, name, kind, item_class_id, parent_id FROM kc_folders
                   WHERE is_active=1 AND item_class_id=? AND parent_id=?
                   ORDER BY sort_order, name`,
                  [itemClassId, parentId]
              );

    const out: FolderNode[] = [];
    for (const row of rows) {
        const [countRows] = await db.query<CountRow[]>(
            `SELECT
               (SELECT COUNT(*) FROM kc_folders WHERE is_active=1 AND parent_id=?) +
               (SELECT COUNT(*) FROM kc_products WHERE is_active=1 AND folder_id=?) AS c`,
            [row.id, row.id]
        );
        out.push({
            id: row.id,
            name: row.name,
            parent_id: parentId || itemClassId,
            kind: row.kind || "folder",
            child_count: Number(countRows[0]?.c || 0),
            path: [...parentPath, row.name],
        });
    }
    return out;
}

async function listProducts(folderId: string, path: string[]): Promise<ProductNode[]> {
    const db = getPool();
    const [rows] = await db.query<ProductRow[]>(
        `SELECT id, name, sku, description, file_url FROM kc_products
         WHERE is_active=1 AND folder_id=? ORDER BY sort_order, name`,
        [folderId]
    );
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        sku: row.sku || "",
        description: row.description || "",
        file_url: row.file_url || "",
        folder_id: folderId,
        folder_path: path,
    }));
}

async function doBrowse(folderId: string): Promise<BrowseResult> {
    const current = !folderId || folderId === "root" ? ROOT_ID : folderId;

    if (current === ROOT_ID) {
        return { folders: await listCategories(), products: [] };
    }

    if (await isCategory(current)) {
        const cat = await getCategory(current);
        return {
            folders: await listItemClasses(current, cat?.name || current),
            products: [],
        };
    }

    if (await isItemClass(current)) {
        const ic = await getItemClass(current);
        if (!ic) return { folders: [], products: [] };
        const cat = await getCategory(ic.category_id);
        const path = [ROOT_NAME, cat?.name || "", ic.name].filter(Boolean);
        return {
            folders: await listFolders(current, null, path),
            products: [],
        };
    }

    if (await isFolder(current)) {
        const folder = await getFolder(current);
        if (!folder) return { folders: [], products: [] };
        const path = await folderPath(folder);
        return {
            folders: await listFolders(folder.item_class_id, current, path),
            products: await listProducts(current, path),
        };
    }

    return { folders: [], products: [] };
}

async function doSearch(query: string, limit: number): Promise<BrowseResult> {
    if (!query) return { folders: [], products: [] };
    const db = getPool();
    const like = `%${query}%`;
    const folders: FolderNode[] = [];
    const products: ProductNode[] = [];

    const [cats] = await db.query<CategoryRow[]>(
        `SELECT id, name FROM kc_categories
         WHERE is_active=1 AND name LIKE ? ORDER BY sort_order, name LIMIT ?`,
        [like, limit]
    );
    for (const row of cats) {
        folders.push({
            id: row.id,
            name: row.name,
            parent_id: ROOT_ID,
            kind: "category",
            child_count: null,
            path: [ROOT_NAME, row.name],
        });
    }

    const [ics] = await db.query<ItemClassRow[]>(
        `SELECT ic.id, ic.name, ic.category_id, c.name AS category_name
         FROM kc_item_classes ic
         JOIN kc_categories c ON c.id = ic.category_id
         WHERE ic.is_active=1 AND c.is_active=1 AND ic.name LIKE ?
         ORDER BY ic.sort_order, ic.name LIMIT ?`,
        [like, limit]
    );
    for (const row of ics) {
        folders.push({
            id: row.id,
            name: row.name,
            parent_id: row.category_id,
            kind: "subcategory",
            child_count: null,
            path: [ROOT_NAME, row.category_name || "", row.name],
        });
    }

    const [flds] = await db.query<FolderRow[]>(
        `SELECT f.id, f.name, f.parent_id, f.item_class_id, f.kind
         FROM kc_folders f
         WHERE f.is_active=1 AND f.name LIKE ?
         ORDER BY f.sort_order, f.name LIMIT ?`,
        [like, limit]
    );
    for (const row of flds) {
        const path = await folderPath(row);
        folders.push({
            id: row.id,
            name: row.name,
            parent_id: row.parent_id || row.item_class_id,
            kind: row.kind || "folder",
            child_count: null,
            path,
        });
    }

    const [prods] = await db.query<ProductRow[]>(
        `SELECT id, folder_id, name, sku, description, file_url
         FROM kc_products
         WHERE is_active=1 AND (name LIKE ? OR sku LIKE ? OR description LIKE ?)
         ORDER BY sort_order, name LIMIT ?`,
        [like, like, like, limit]
    );
    for (const row of prods) {
        const folder = await getFolder(row.folder_id);
        const path = folder ? await folderPath(folder) : [ROOT_NAME];
        products.push({
            id: row.id,
            name: row.name,
            sku: row.sku || "",
            description: row.description || "",
            file_url: row.file_url || "",
            folder_id: row.folder_id,
            folder_path: path,
        });
    }

    const clippedFolders = folders.slice(0, limit);
    const rem = Math.max(0, limit - clippedFolders.length);
    return { folders: clippedFolders, products: products.slice(0, rem) };
}

async function getProduct(productId: string): Promise<ProductNode | null> {
    const db = getPool();
    const [rows] = await db.query<ProductRow[]>(
        `SELECT id, folder_id, name, sku, description, file_url
         FROM kc_products WHERE is_active=1 AND id=? LIMIT 1`,
        [productId]
    );
    const row = rows[0];
    if (!row) return null;
    const folder = await getFolder(row.folder_id);
    const path = folder ? await folderPath(folder) : [ROOT_NAME];
    return {
        id: row.id,
        name: row.name,
        sku: row.sku || "",
        description: row.description || "",
        file_url: row.file_url || "",
        folder_id: row.folder_id,
        folder_path: path,
    };
}

async function ensureItemsFolder(itemClassId: string): Promise<string> {
    const id = `kc_fld_items_${itemClassId}`;
    if (await isFolder(id)) return id;
    const db = getPool();
    await db.query(
        `INSERT INTO kc_folders (id, item_class_id, parent_id, name, kind, sort_order, is_active)
         VALUES (?,?,NULL,?,'folder',0,1)`,
        [id, itemClassId, "Items"]
    );
    return id;
}

async function createFolder(body: JsonBody): Promise<FolderNode> {
    const name = String(body.name || "").trim();
    if (!name) throw httpError("Folder name is required", 400);

    let parentId = String(body.parent_id || ROOT_ID).trim() || ROOT_ID;
    if (parentId === "" || parentId === "root") parentId = ROOT_ID;

    const db = getPool();

    if (parentId === ROOT_ID) {
        const id =
            body.id && String(body.id).trim()
                ? String(body.id)
                : newId("kc_cat_");
        await db.query(
            "INSERT INTO kc_categories (id, name, sort_order, is_active) VALUES (?,?,0,1)",
            [id, name]
        );
        return {
            id,
            name,
            parent_id: ROOT_ID,
            kind: "category",
            child_count: 0,
            path: [ROOT_NAME, name],
        };
    }

    if (await isCategory(parentId)) {
        const cat = await getCategory(parentId);
        const id =
            body.id && String(body.id).trim()
                ? String(body.id)
                : newId("kc_ic_");
        await db.query(
            "INSERT INTO kc_item_classes (id, category_id, name, sort_order, is_active) VALUES (?,?,?,0,1)",
            [id, parentId, name]
        );
        return {
            id,
            name,
            parent_id: parentId,
            kind: "subcategory",
            child_count: 0,
            path: [ROOT_NAME, cat?.name || parentId, name],
        };
    }

    let itemClassId: string | null = null;
    let parentFolderId: string | null = null;
    if (await isItemClass(parentId)) {
        itemClassId = parentId;
    } else if (await isFolder(parentId)) {
        const parentFolder = await getFolder(parentId);
        if (!parentFolder) throw httpError("Invalid parent for folder", 400);
        itemClassId = parentFolder.item_class_id;
        parentFolderId = parentId;
    } else {
        throw httpError("Invalid parent for folder", 400);
    }

    const id =
        body.id && String(body.id).trim() ? String(body.id) : newId("kc_fld_");
    const kind = String(body.kind || "folder").trim() || "folder";
    await db.query(
        `INSERT INTO kc_folders (id, item_class_id, parent_id, name, kind, sort_order, is_active)
         VALUES (?,?,?,?,?,0,1)`,
        [id, itemClassId, parentFolderId, name, kind]
    );
    const folder = await getFolder(id);
    return {
        id,
        name,
        parent_id: parentFolderId || itemClassId,
        kind,
        child_count: 0,
        path: folder ? await folderPath(folder) : [ROOT_NAME, name],
    };
}

async function createProduct(body: JsonBody): Promise<ProductNode> {
    const name = String(body.name || "").trim();
    if (!name) throw httpError("Product name is required", 400);

    let folderId = String(body.folder_id || "").trim();
    if (!folderId || folderId === ROOT_ID) {
        throw httpError("Select a folder under a KC Item Class", 400);
    }
    if (await isItemClass(folderId)) {
        folderId = await ensureItemsFolder(folderId);
    }
    if (!(await isFolder(folderId))) {
        throw httpError("Invalid folder for product", 400);
    }

    const id =
        body.id && String(body.id).trim() ? String(body.id) : newId("kc_prd_");
    let sku = String(body.sku || "").trim();
    if (!sku) sku = id;
    const description = String(body.description || "").trim();
    let fileUrl = String(body.file_url || "").trim();
    if (!fileUrl && body.fileUrl != null) {
        fileUrl = String(body.fileUrl).trim();
    }

    const db = getPool();
    await db.query(
        `INSERT INTO kc_products (id, folder_id, name, sku, description, file_url, sort_order, is_active)
         VALUES (?,?,?,?,?,?,0,1)`,
        [id, folderId, name, sku, description, fileUrl || null]
    );
    const product = await getProduct(id);
    if (!product) throw new Error("Failed to load created product");
    return product;
}

async function softDeleteFolder(folderId: string): Promise<void> {
    const db = getPool();
    const [catResult] = await db.query<ResultSetHeader>(
        "UPDATE kc_categories SET is_active=0 WHERE id=?",
        [folderId]
    );
    if ((catResult.affectedRows || 0) > 0) {
        await db.query("UPDATE kc_item_classes SET is_active=0 WHERE category_id=?", [
            folderId,
        ]);
        await db.query(
            `UPDATE kc_folders f
             JOIN kc_item_classes ic ON f.item_class_id=ic.id
             SET f.is_active=0 WHERE ic.category_id=?`,
            [folderId]
        );
        await db.query(
            `UPDATE kc_products p
             JOIN kc_folders f ON p.folder_id=f.id
             JOIN kc_item_classes ic ON f.item_class_id=ic.id
             SET p.is_active=0 WHERE ic.category_id=?`,
            [folderId]
        );
        return;
    }

    const [icResult] = await db.query<ResultSetHeader>(
        "UPDATE kc_item_classes SET is_active=0 WHERE id=?",
        [folderId]
    );
    if ((icResult.affectedRows || 0) > 0) {
        await db.query("UPDATE kc_folders SET is_active=0 WHERE item_class_id=?", [
            folderId,
        ]);
        await db.query(
            `UPDATE kc_products p
             JOIN kc_folders f ON p.folder_id=f.id
             SET p.is_active=0 WHERE f.item_class_id=?`,
            [folderId]
        );
        return;
    }

    await db.query("UPDATE kc_folders SET is_active=0 WHERE id=?", [folderId]);
    let changed = true;
    while (changed) {
        const [result] = await db.query<ResultSetHeader>(`
            UPDATE kc_folders child
            JOIN kc_folders parent ON child.parent_id = parent.id
            SET child.is_active = 0
            WHERE parent.is_active = 0 AND child.is_active = 1
        `);
        changed = (result.affectedRows || 0) > 0;
    }
    await db.query(`
        UPDATE kc_products p
        JOIN kc_folders f ON p.folder_id = f.id
        SET p.is_active = 0
        WHERE f.is_active = 0 AND p.is_active = 1
    `);
    await db.query(
        "UPDATE kc_products SET is_active=0 WHERE folder_id=? AND is_active=1",
        [folderId]
    );
}

async function softDeleteProduct(productId: string): Promise<void> {
    const db = getPool();
    await db.query(
        "UPDATE kc_products SET is_active=0 WHERE id=? AND is_active=1",
        [productId]
    );
}

async function writeActionLog(body: JsonBody): Promise<{ id: string; ok: true }> {
    const action = String(body.action || "").trim();
    if (!ALLOWED_ACTIONS.has(action)) {
        throw httpError("Invalid action", 400);
    }
    const id =
        body.id && String(body.id).trim()
            ? String(body.id)
            : newId("log_", 8);
    const actorId = String(body.actor_id || "").slice(0, 128);
    const actorName = String(body.actor_name || "").slice(0, 255);
    const targetId = String(body.target_id || "").slice(0, 64);
    const targetName = String(body.target_name || "").slice(0, 512);
    const detail = String(body.detail || "").slice(0, 2000);

    const db = getPool();
    await db.query(
        `INSERT INTO inventory_action_logs
         (id, action, actor_id, actor_name, target_id, target_name, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, action, actorId, actorName, targetId, targetName, detail]
    );
    return { id, ok: true };
}

async function listActionLogs(limitRaw: unknown): Promise<{ logs: Record<string, string>[] }> {
    let lim = parseInt(String(limitRaw ?? 200), 10);
    if (!Number.isFinite(lim) || lim < 1) lim = 200;
    if (lim > 500) lim = 500;

    const db = getPool();
    const [rows] = await db.query<ActionLogRow[]>(
        `SELECT id, action, actor_id, actor_name, target_id, target_name, detail, created_at
         FROM inventory_action_logs
         ORDER BY created_at DESC
         LIMIT ?`,
        [lim]
    );

    return {
        logs: rows.map((row) => {
            let created: string = "";
            if (row.created_at instanceof Date) {
                created = row.created_at
                    .toISOString()
                    .replace("T", " ")
                    .replace(/\.\d{3}Z$/, "");
            } else {
                created = String(row.created_at || "");
            }
            return {
                id: row.id,
                action: row.action,
                actor_id: row.actor_id || "",
                actor_name: row.actor_name || "",
                target_id: row.target_id || "",
                target_name: row.target_name || "",
                detail: row.detail || "",
                created_at: created,
            };
        }),
    };
}

function requireAdmin(request?: Request): true {
    const token = process.env.INVENTORY_ADMIN_TOKEN || "";
    if (!token) return true;
    const header = request?.headers?.get?.("x-inventory-admin-token") || "";
    if (header !== token) throw httpError("Admin token required", 403);
    return true;
}

export const ProductDirectoryService = {
    ROOT_ID,
    ROOT_NAME,

    async health() {
        return { ok: true };
    },

    async browse(body: JsonBody = {}) {
        await ensureTables();
        return doBrowse(String(body.folder_id || "").trim());
    },

    async search(body: JsonBody = {}) {
        await ensureTables();
        let limit = parseInt(String(body.limit ?? 40), 10);
        if (!Number.isFinite(limit) || limit < 1) limit = 40;
        if (limit > 200) limit = 200;
        return doSearch(String(body.query || "").trim(), limit);
    },

    async product(body: JsonBody = {}) {
        await ensureTables();
        const productId = String(body.product_id || "").trim();
        if (!productId) throw httpError("product_id is required", 400);
        const product = await getProduct(productId);
        if (!product) throw httpError("Product not found", 404);
        return product;
    },

    async folderCreate(body: JsonBody = {}, request?: Request) {
        requireAdmin(request);
        await ensureTables();
        return createFolder(body);
    },

    async productCreate(body: JsonBody = {}, request?: Request) {
        requireAdmin(request);
        await ensureTables();
        return createProduct(body);
    },

    async folderDelete(body: JsonBody = {}, request?: Request) {
        requireAdmin(request);
        await ensureTables();
        const folderId = String(body.folder_id || "").trim();
        if (!folderId) throw httpError("folder_id is required", 400);
        await softDeleteFolder(folderId);
        return { deleted: true };
    },

    async productDelete(body: JsonBody = {}, request?: Request) {
        requireAdmin(request);
        await ensureTables();
        const productId = String(body.product_id || "").trim();
        if (!productId) throw httpError("product_id is required", 400);
        await softDeleteProduct(productId);
        return { deleted: true };
    },

    async actionLogWrite(body: JsonBody = {}) {
        await ensureTables();
        return writeActionLog(body);
    },

    async actionLogsList(body: JsonBody = {}, request?: Request) {
        requireAdmin(request);
        await ensureTables();
        return listActionLogs(body.limit);
    },
};

export const PRODUCT_DIRECTORY_ACTIONS: Record<string, keyof typeof ProductDirectoryService> = {
    health: "health",
    inventory_health: "health",
    browse: "browse",
    inventory_browse: "browse",
    search: "search",
    inventory_search: "search",
    product: "product",
    inventory_product: "product",
    folder_create: "folderCreate",
    inventory_folder_create: "folderCreate",
    product_create: "productCreate",
    inventory_product_create: "productCreate",
    folder_delete: "folderDelete",
    inventory_folder_delete: "folderDelete",
    product_delete: "productDelete",
    inventory_product_delete: "productDelete",
    action_log: "actionLogWrite",
    inventory_action_log: "actionLogWrite",
    action_logs: "actionLogsList",
    inventory_action_logs: "actionLogsList",
};

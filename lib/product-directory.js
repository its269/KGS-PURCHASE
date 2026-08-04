/**
 * Product Directory API — folder browse / search / custom folders & products.
 * Ported from product-directory inventory_welcome.php / inventory_live_api.py.
 *
 * Env:
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD
 *   MYSQL_INVENTORY_DATABASE (default db_kelin_inventory)
 *   INVENTORY_ADMIN_TOKEN (optional; admin mutations need X-Inventory-Admin-Token)
 */
import crypto from "crypto";
import mysql from "mysql2/promise";

const ROOT_ID = "kg-posting";
const ROOT_NAME = "KG Posting Class";

const POSTING_FOLDERS = {
    machine: { name: "Machine", code: "MCHPRINTER" },
    inks: { name: "Inks", code: "INKS" },
    media: { name: "Media", code: "CONSUMABLE" },
    tools: { name: "Tools", code: "ACCSSORIES" },
};

const ITEM_CLASS_LABELS = {
    ECOEPSON: "Eco Solvent",
    ECOSOLVENT: "Eco Solvent",
    SOLVENTPR: "Solvent",
    SOLVENT: "Solvent",
    SUBLIMTION: "Sublimation",
    UVPRINTER: "UV Printer",
    FLATBEDCUT: "Flatbed Cutter",
    "FLATBED CU": "Flatbed Cutter",
    LASERMACH: "Laser Machine",
    HEATPRESS: "Heat Press",
    "HEAT PRESS": "Heat Press",
    CUTTERPLOT: "Cutter Plotter",
    PRINTHEAD: "Printhead",
    LAMINATOR: "Laminator",
    ACCSSORIES: "Accessories",
    TARPAULIN: "Tarpaulin",
    VINYLSTIC: "Vinyl Sticker",
    LABEL: "Label",
    PVCBOARD: "PVC Board",
    ACRYLIC: "Acrylic",
    TEXTILE: "Textile",
    DISPLAY: "Display",
};

const POSTING_CODES = Object.values(POSTING_FOLDERS).map((m) => m.code);
const ALLOWED_ACTIONS = new Set(["opened_product", "searched", "downloaded"]);

let pool = null;

function getPool() {
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

async function ensureTables() {
    const db = getPool();
    await db.query(`
        CREATE TABLE IF NOT EXISTS inventory_custom_folders (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS inventory_custom_products (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          name VARCHAR(512) NOT NULL,
          sku VARCHAR(128) NOT NULL,
          description TEXT NULL,
          file_url VARCHAR(1024) NULL,
          folder_id VARCHAR(64) NOT NULL,
          folder_path_json JSON NULL,
          created_by VARCHAR(128) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          deleted_at TIMESTAMP NULL DEFAULT NULL,
          KEY idx_folder (folder_id),
          KEY idx_sku (sku),
          KEY idx_deleted (deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
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
    try {
        await db.query(
            `ALTER TABLE inventory_custom_products
             ADD COLUMN file_url VARCHAR(1024) NULL AFTER description`
        );
    } catch {
        /* column already exists */
    }
}

function labelForItemClass(code) {
    if (code == null || code === "") return "Other";
    const key = String(code).trim();
    if (ITEM_CLASS_LABELS[key]) return ITEM_CLASS_LABELS[key];
    return key
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function folderIdFor(parent, itemClass) {
    const raw = String(itemClass || "other")
        .trim()
        .toLowerCase()
        .replace(/ /g, "-")
        .replace(/[^a-z0-9_-]+/g, "-");
    return `${parent}__${raw}`;
}

function parsePath(json) {
    if (json == null || json === "") return [];
    try {
        const decoded = typeof json === "string" ? JSON.parse(json) : json;
        if (!Array.isArray(decoded)) return [];
        return decoded.map(String);
    } catch {
        return [];
    }
}

function mapCustomProduct(row) {
    return {
        id: row.id,
        name: row.name,
        sku: row.sku,
        description: row.description || "",
        file_url: row.file_url != null ? String(row.file_url) : "",
        folder_id: row.folder_id,
        folder_path: parsePath(row.folder_path_json),
    };
}

async function customFolders(parentId) {
    const db = getPool();
    const [rows] = await db.query(
        `SELECT id, name, parent_id, kind, path_json, child_count
         FROM inventory_custom_folders
         WHERE deleted_at IS NULL AND parent_id <=> ?
         ORDER BY name`,
        [parentId]
    );
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        parent_id: row.parent_id,
        kind: row.kind || "subcategory",
        child_count: Number(row.child_count) || 0,
        path: parsePath(row.path_json),
    }));
}

async function customProducts(folderId) {
    const db = getPool();
    try {
        const [rows] = await db.query(
            `SELECT id, name, sku, description, file_url, folder_id, folder_path_json
             FROM inventory_custom_products
             WHERE deleted_at IS NULL AND folder_id = ?
             ORDER BY name`,
            [folderId]
        );
        return rows.map(mapCustomProduct);
    } catch {
        const [rows] = await db.query(
            `SELECT id, name, sku, description, folder_id, folder_path_json
             FROM inventory_custom_products
             WHERE deleted_at IS NULL AND folder_id = ?
             ORDER BY name`,
            [folderId]
        );
        return rows.map(mapCustomProduct);
    }
}

async function doBrowse(folderId) {
    const db = getPool();
    const current = !folderId || folderId === "root" ? ROOT_ID : folderId;

    if (current === ROOT_ID) {
        const folders = [];
        for (const [fid, meta] of Object.entries(POSTING_FOLDERS)) {
            const [[countRow]] = await db.query(
                `SELECT COUNT(DISTINCT item_class) AS c FROM inventory_items
                 WHERE item_status = 'Active' AND company_id = 'main'
                   AND posting_class = ?`,
                [meta.code]
            );
            const custom = await customFolders(fid);
            folders.push({
                id: fid,
                name: meta.name,
                parent_id: ROOT_ID,
                kind: "category",
                child_count: (Number(countRow?.c) || 0) + custom.length,
                path: [ROOT_NAME, meta.name],
            });
        }
        return {
            folders: [...folders, ...(await customFolders(ROOT_ID))],
            products: await customProducts(ROOT_ID),
        };
    }

    if (POSTING_FOLDERS[current]) {
        const meta = POSTING_FOLDERS[current];
        const [rows] = await db.query(
            `SELECT item_class, COUNT(DISTINCT inventory_id) AS c
             FROM inventory_items
             WHERE item_status = 'Active' AND company_id = 'main'
               AND posting_class = ?
             GROUP BY item_class
             ORDER BY c DESC, item_class ASC`,
            [meta.code]
        );
        const folders = rows.map((row) => {
            const subName = labelForItemClass(row.item_class);
            return {
                id: folderIdFor(current, row.item_class),
                name: subName,
                parent_id: current,
                kind: "subcategory",
                child_count: Number(row.c) || 0,
                path: [ROOT_NAME, meta.name, subName],
            };
        });
        return {
            folders: [...folders, ...(await customFolders(current))],
            products: await customProducts(current),
        };
    }

    const subMatch = String(current).match(/^([a-z]+)__(.+)$/);
    if (subMatch && POSTING_FOLDERS[subMatch[1]]) {
        const parent = subMatch[1];
        const meta = POSTING_FOLDERS[parent];
        const [classRows] = await db.query(
            `SELECT DISTINCT item_class FROM inventory_items
             WHERE item_status = 'Active' AND company_id = 'main'
               AND posting_class = ?`,
            [meta.code]
        );
        let matched = null;
        for (const row of classRows) {
            const ic = String(row.item_class || "").trim();
            if (folderIdFor(parent, ic) === current) {
                matched = ic;
                break;
            }
        }
        let products = [];
        if (matched != null) {
            const subName = labelForItemClass(matched);
            const [prodRows] = await db.query(
                `SELECT inventory_id, inventory_name, type
                 FROM inventory_items
                 WHERE item_status = 'Active' AND company_id = 'main'
                   AND posting_class = ? AND item_class = ?
                 GROUP BY inventory_id, inventory_name, type
                 ORDER BY inventory_name
                 LIMIT 2000`,
                [meta.code, matched]
            );
            products = prodRows.map((row) => {
                let desc = `${meta.name} · ${subName}`;
                if (row.type) desc += ` · ${row.type}`;
                return {
                    id: row.inventory_id,
                    name: row.inventory_name || row.inventory_id,
                    sku: row.inventory_id,
                    description: desc,
                    file_url: "",
                    folder_id: current,
                    folder_path: [ROOT_NAME, meta.name, subName],
                };
            });
        }
        return {
            folders: await customFolders(current),
            products: [...products, ...(await customProducts(current))],
        };
    }

    return {
        folders: await customFolders(current),
        products: await customProducts(current),
    };
}

async function doSearch(query, limit = 40) {
    const db = getPool();
    if (!query) return { folders: [], products: [] };

    const like = `%${query}%`;
    const [rows] = await db.query(
        `SELECT inventory_id, inventory_name, item_class, posting_class, type
         FROM inventory_items
         WHERE item_status = 'Active' AND company_id = 'main'
           AND posting_class IN (?, ?, ?, ?)
           AND (inventory_name LIKE ? OR inventory_id LIKE ? OR item_class LIKE ?)
         GROUP BY inventory_id, inventory_name, item_class, posting_class, type
         ORDER BY inventory_name
         LIMIT ?`,
        [...POSTING_CODES, like, like, like, limit]
    );

    const codeToId = {};
    const codeToName = {};
    for (const [fid, meta] of Object.entries(POSTING_FOLDERS)) {
        codeToId[meta.code] = fid;
        codeToName[meta.code] = meta.name;
    }

    const products = [];
    const folderHits = {};
    const qLower = query.toLowerCase();

    for (const row of rows) {
        const pc = row.posting_class;
        const pid = codeToId[pc] || "machine";
        const pname = codeToName[pc] || pc;
        const subName = labelForItemClass(row.item_class);
        const subId = folderIdFor(pid, row.item_class);
        products.push({
            id: row.inventory_id,
            name: row.inventory_name || row.inventory_id,
            sku: row.inventory_id,
            description: `${pname} · ${subName}`,
            file_url: "",
            folder_id: subId,
            folder_path: [ROOT_NAME, pname, subName],
        });
        if (!folderHits[subId] && subName.toLowerCase().includes(qLower)) {
            folderHits[subId] = {
                id: subId,
                name: subName,
                parent_id: pid,
                kind: "subcategory",
                child_count: null,
                path: [ROOT_NAME, pname, subName],
            };
        }
        if (!folderHits[pid] && pname.toLowerCase().includes(qLower)) {
            folderHits[pid] = {
                id: pid,
                name: pname,
                parent_id: ROOT_ID,
                kind: "category",
                child_count: null,
                path: [ROOT_NAME, pname],
            };
        }
    }

    const [folderRows] = await db.query(
        `SELECT id, name, parent_id, kind, path_json, child_count
         FROM inventory_custom_folders
         WHERE deleted_at IS NULL AND name LIKE ?
         ORDER BY name LIMIT ?`,
        [like, limit]
    );
    for (const row of folderRows) {
        folderHits[row.id] = {
            id: row.id,
            name: row.name,
            parent_id: row.parent_id,
            kind: row.kind || "subcategory",
            child_count: Number(row.child_count) || 0,
            path: parsePath(row.path_json),
        };
    }

    try {
        const [prodRows] = await db.query(
            `SELECT id, name, sku, description, file_url, folder_id, folder_path_json
             FROM inventory_custom_products
             WHERE deleted_at IS NULL AND (name LIKE ? OR sku LIKE ? OR description LIKE ?)
             ORDER BY name LIMIT ?`,
            [like, like, like, limit]
        );
        for (const row of prodRows) products.push(mapCustomProduct(row));
    } catch {
        const [prodRows] = await db.query(
            `SELECT id, name, sku, description, folder_id, folder_path_json
             FROM inventory_custom_products
             WHERE deleted_at IS NULL AND (name LIKE ? OR sku LIKE ? OR description LIKE ?)
             ORDER BY name LIMIT ?`,
            [like, like, like, limit]
        );
        for (const row of prodRows) products.push(mapCustomProduct(row));
    }

    const folders = Object.values(folderHits).slice(0, limit);
    const remaining = Math.max(0, limit - folders.length);
    return {
        folders,
        products: products.slice(0, remaining),
    };
}

async function getProduct(productId) {
    const db = getPool();
    try {
        const [[custom]] = await db.query(
            `SELECT id, name, sku, description, file_url, folder_id, folder_path_json
             FROM inventory_custom_products
             WHERE deleted_at IS NULL AND id = ? LIMIT 1`,
            [productId]
        );
        if (custom) return mapCustomProduct(custom);
    } catch {
        const [[custom]] = await db.query(
            `SELECT id, name, sku, description, folder_id, folder_path_json
             FROM inventory_custom_products
             WHERE deleted_at IS NULL AND id = ? LIMIT 1`,
            [productId]
        );
        if (custom) return mapCustomProduct(custom);
    }

    const [[row]] = await db.query(
        `SELECT inventory_id, inventory_name, item_class, posting_class, type
         FROM inventory_items
         WHERE item_status = 'Active' AND company_id = 'main'
           AND inventory_id = ? LIMIT 1`,
        [productId]
    );
    if (!row) return null;

    const codeToId = {};
    const codeToName = {};
    for (const [fid, meta] of Object.entries(POSTING_FOLDERS)) {
        codeToId[meta.code] = fid;
        codeToName[meta.code] = meta.name;
    }
    const pc = row.posting_class;
    const pid = codeToId[pc] || "machine";
    const pname = codeToName[pc] || "Machine";
    const subName = labelForItemClass(row.item_class);
    return {
        id: row.inventory_id,
        name: row.inventory_name || row.inventory_id,
        sku: row.inventory_id,
        description: `${pname} · ${subName}`,
        file_url: "",
        folder_id: folderIdFor(pid, row.item_class),
        folder_path: [ROOT_NAME, pname, subName],
    };
}

async function createFolder(body = {}) {
    const db = getPool();
    const name = String(body.name || "").trim();
    if (!name) throw Object.assign(new Error("Folder name is required"), { status: 400 });

    const parentId = String(body.parent_id || ROOT_ID).trim() || ROOT_ID;
    const kind = String(body.kind || "subcategory").trim() || "subcategory";
    const parentPath = Array.isArray(body.parent_path) ? body.parent_path : [ROOT_NAME];
    const id =
        body.id && String(body.id).trim()
            ? String(body.id)
            : `custom_${crypto.randomBytes(6).toString("hex")}`;
    const path = [...parentPath, name];
    const createdBy = String(body.created_by || "").slice(0, 128);

    await db.query(
        `INSERT INTO inventory_custom_folders
         (id, name, parent_id, kind, path_json, child_count, created_by)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [id, name, parentId, kind, JSON.stringify(path), createdBy]
    );

    return {
        id,
        name,
        parent_id: parentId,
        kind,
        child_count: 0,
        path,
    };
}

async function createProduct(body = {}) {
    const db = getPool();
    const name = String(body.name || "").trim();
    if (!name) throw Object.assign(new Error("Product name is required"), { status: 400 });

    const folderId = String(body.folder_id || ROOT_ID).trim() || ROOT_ID;
    const id =
        body.id && String(body.id).trim()
            ? String(body.id)
            : `custom_prod_${crypto.randomBytes(6).toString("hex")}`;
    const sku = String(body.sku || "").trim() || id;
    const description = String(body.description || "").trim();
    const fileUrl = String(body.file_url || body.fileUrl || "").trim();
    const folderPath = Array.isArray(body.folder_path) ? body.folder_path : [ROOT_NAME];
    const createdBy = String(body.created_by || "").slice(0, 128);

    try {
        await db.query(
            `INSERT INTO inventory_custom_products
             (id, name, sku, description, file_url, folder_id, folder_path_json, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                name,
                sku,
                description,
                fileUrl || null,
                folderId,
                JSON.stringify([...folderPath]),
                createdBy,
            ]
        );
    } catch {
        await db.query(
            `INSERT INTO inventory_custom_products
             (id, name, sku, description, folder_id, folder_path_json, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, name, sku, description, folderId, JSON.stringify([...folderPath]), createdBy]
        );
    }

    return {
        id,
        name,
        sku,
        description,
        file_url: fileUrl,
        folder_id: folderId,
        folder_path: [...folderPath],
    };
}

async function softDeleteFolder(folderId) {
    const db = getPool();
    await db.query(
        `UPDATE inventory_custom_folders SET deleted_at = NOW()
         WHERE id = ? AND deleted_at IS NULL`,
        [folderId]
    );

    let changed = true;
    while (changed) {
        const [result] = await db.query(`
            UPDATE inventory_custom_folders child
            JOIN inventory_custom_folders parent ON child.parent_id = parent.id
            SET child.deleted_at = NOW()
            WHERE parent.deleted_at IS NOT NULL AND child.deleted_at IS NULL
        `);
        changed = (result.affectedRows || 0) > 0;
    }

    await db.query(`
        UPDATE inventory_custom_products p
        JOIN inventory_custom_folders f ON p.folder_id = f.id
        SET p.deleted_at = NOW()
        WHERE f.deleted_at IS NOT NULL AND p.deleted_at IS NULL
    `);
    await db.query(
        `UPDATE inventory_custom_products SET deleted_at = NOW()
         WHERE folder_id = ? AND deleted_at IS NULL`,
        [folderId]
    );
}

async function softDeleteProduct(productId) {
    const db = getPool();
    await db.query(
        `UPDATE inventory_custom_products SET deleted_at = NOW()
         WHERE id = ? AND deleted_at IS NULL`,
        [productId]
    );
}

async function writeActionLog(body = {}) {
    const db = getPool();
    const action = String(body.action || "").trim();
    if (!ALLOWED_ACTIONS.has(action)) {
        throw Object.assign(new Error("Invalid action"), { status: 400 });
    }
    const id =
        body.id && String(body.id).trim()
            ? String(body.id)
            : `log_${crypto.randomBytes(8).toString("hex")}`;
    const actorId = String(body.actor_id || "").slice(0, 128);
    const actorName = String(body.actor_name || "").slice(0, 255);
    const targetId = String(body.target_id || "").slice(0, 64);
    const targetName = String(body.target_name || "").slice(0, 512);
    const detail = String(body.detail || "").slice(0, 2000);

    await db.query(
        `INSERT INTO inventory_action_logs
         (id, action, actor_id, actor_name, target_id, target_name, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, action, actorId, actorName, targetId, targetName, detail]
    );
    return { id, ok: true };
}

async function listActionLogs(limit = 200) {
    const db = getPool();
    let lim = parseInt(limit, 10);
    if (!Number.isFinite(lim) || lim < 1) lim = 200;
    if (lim > 500) lim = 500;

    const [rows] = await db.query(
        `SELECT id, action, actor_id, actor_name, target_id, target_name, detail, created_at
         FROM inventory_action_logs
         ORDER BY created_at DESC
         LIMIT ?`,
        [lim]
    );

    return {
        logs: rows.map((row) => {
            let created = row.created_at || "";
            if (created instanceof Date) {
                created = created.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
            }
            return {
                id: row.id,
                action: row.action,
                actor_id: row.actor_id || "",
                actor_name: row.actor_name || "",
                target_id: row.target_id || "",
                target_name: row.target_name || "",
                detail: row.detail || "",
                created_at: String(created),
            };
        }),
    };
}

function requireAdmin(request) {
    const token = process.env.INVENTORY_ADMIN_TOKEN || "";
    if (!token) return true;
    const header = request.headers.get("x-inventory-admin-token") || "";
    if (header !== token) {
        const err = new Error("Admin token required");
        err.status = 403;
        throw err;
    }
    return true;
}

export const ProductDirectoryService = {
    ROOT_ID,
    ROOT_NAME,
    POSTING_FOLDERS,

    async health() {
        return { ok: true };
    },

    async browse(body = {}) {
        await ensureTables();
        return doBrowse(String(body.folder_id || "").trim());
    },

    async search(body = {}) {
        await ensureTables();
        let limit = parseInt(body.limit, 10);
        if (!Number.isFinite(limit) || limit < 1) limit = 40;
        if (limit > 200) limit = 200;
        return doSearch(String(body.query || "").trim(), limit);
    },

    async product(body = {}) {
        await ensureTables();
        const productId = String(body.product_id || "").trim();
        if (!productId) {
            const err = new Error("product_id is required");
            err.status = 400;
            throw err;
        }
        const product = await getProduct(productId);
        if (!product) {
            const err = new Error("Product not found");
            err.status = 404;
            throw err;
        }
        return product;
    },

    async folderCreate(body = {}, request) {
        requireAdmin(request);
        await ensureTables();
        return createFolder(body);
    },

    async productCreate(body = {}, request) {
        requireAdmin(request);
        await ensureTables();
        return createProduct(body);
    },

    async folderDelete(body = {}, request) {
        requireAdmin(request);
        await ensureTables();
        const folderId = String(body.folder_id || "").trim();
        if (!folderId || !folderId.startsWith("custom_")) {
            const err = new Error("Only custom folders can be deleted");
            err.status = 400;
            throw err;
        }
        await softDeleteFolder(folderId);
        return { deleted: true };
    },

    async productDelete(body = {}, request) {
        requireAdmin(request);
        await ensureTables();
        const productId = String(body.product_id || "").trim();
        if (!productId || !productId.startsWith("custom_")) {
            const err = new Error("Only custom products can be deleted");
            err.status = 400;
            throw err;
        }
        await softDeleteProduct(productId);
        return { deleted: true };
    },

    async actionLogWrite(body = {}) {
        await ensureTables();
        return writeActionLog(body);
    },

    async actionLogsList(body = {}, request) {
        requireAdmin(request);
        await ensureTables();
        return listActionLogs(body.limit);
    },
};

export const PRODUCT_DIRECTORY_ACTIONS = {
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

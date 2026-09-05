export type CmsMediaRow = {
  inventory_id: string;
  inventory_name: string;
  model_id: number | string | null;
  model_name: string | null;
  media_url: string;
};

export type FolderOut = {
  id: string;
  name: string;
  parent_id: string | null;
  kind: string;
  child_count: number | null;
  path: string[];
};

export type ProductOut = {
  id: string;
  name: string;
  sku: string;
  description: string;
  file_url: string;
  folder_id: string;
  folder_path: string[];
};

const DEFAULT_ORIGIN = "https://kelinconnect.com";

export function mediaKindToColumn(
  kind: string,
): "image_url" | "brochure_url" | "youtube_url" | null {
  switch (kind.trim().toLowerCase()) {
    case "images":
    case "image":
      return "image_url";
    case "brochure":
    case "brochures":
      return "brochure_url";
    case "videos":
    case "video":
      return "youtube_url";
    default:
      return null;
  }
}

export function flowchartMediaKind(
  folderId: string,
  folderName: string,
  itemClassId: string,
): "brochure" | "images" | "videos" | null {
  const normalizedName = folderName.trim().toLowerCase();
  for (const kind of ["brochure", "images", "videos"] as const) {
    if (
      normalizedName === kind ||
      folderId === `kc_fld_${kind}_${itemClassId}`
    ) {
      return kind;
    }
  }
  return null;
}

export function resolveCmsMediaUrl(
  url: string,
  origin = DEFAULT_ORIGIN,
): string {
  const value = url.trim();
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `http:${value}`;
  if (value.startsWith("/")) return `${origin}${value}`;
  return `${origin}/${value}`;
}

export function isYoutubeUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  return (
    u.includes("youtube.com") ||
    u.includes("youtu.be") ||
    u.includes("youtube-nocookie.com")
  );
}

export function buildCmsModelFolderId(
  kind: string,
  itemClassId: string,
  modelId: number | string,
): string {
  return `kc_fld_cmsmodel_${kind}_${itemClassId}_${modelId}`;
}

export function parseCmsModelFolderId(
  folderId: string,
): { kind: string; itemClassId: string; modelId: string } | null {
  const m = folderId.match(
    /^kc_fld_cmsmodel_(brochure|images|videos)_(.+)_(\d+)$/,
  );
  if (!m) return null;
  return { kind: m[1], itemClassId: m[2], modelId: m[3] };
}

export function groupCmsMediaBrowse(
  rows: CmsMediaRow[],
  kind: string,
  itemClassId: string,
  basePath: string[],
  options?: { groupByModel?: boolean; allowEmptyUrl?: boolean },
): { folders: FolderOut[]; products: ProductOut[] } {
  const groupByModel = options?.groupByModel === true;
  const allowEmptyUrl = options?.allowEmptyUrl === true;
  const folders: FolderOut[] = [];
  const products: ProductOut[] = [];
  const byModel = new Map<
    string,
    { name: string; count: number }
  >();

  for (const row of rows) {
    const urls = expandMediaUrls(row.media_url);
    if (urls.length === 0 && !allowEmptyUrl) continue;
    const mid = row.model_id;
    const hasModel =
      groupByModel &&
      mid !== null &&
      mid !== undefined &&
      String(mid).trim() !== "" &&
      String(mid) !== "0";

    if (hasModel) {
      const key = String(mid);
      const name = (row.model_name || `Model ${key}`).trim();
      const prev = byModel.get(key);
      byModel.set(key, {
        name,
        count: (prev?.count ?? 0) + urls.length,
      });
      continue;
    }

    urls.forEach((url, index) => {
      products.push({
        id: cmsMediaProductId(row.inventory_id, kind, index),
        name:
          urls.length > 1
            ? `${row.inventory_name} (${index + 1})`
            : row.inventory_name,
        sku: row.inventory_id,
        description: "",
        file_url: url,
        folder_id: `kc_fld_${kind}_${itemClassId}`,
        folder_path: basePath,
      });
    });
  }

  if (groupByModel) {
    for (const [modelId, info] of [...byModel.entries()].sort((a, b) =>
      a[1].name.localeCompare(b[1].name),
    )) {
      // Never show empty model folders (avoids duplicate "Uv" with No items).
      if (info.count <= 0) continue;
      folders.push({
        id: buildCmsModelFolderId(kind, itemClassId, modelId),
        name: info.name,
        parent_id: `kc_fld_${kind}_${itemClassId}`,
        kind: "folder",
        child_count: info.count,
        path: [...basePath, info.name],
      });
    }
  }

  return { folders, products };
}

/**
 * All KC categories use Machine-style path:
 * Category → Item Class → Brochure | Images | Videos → model folder → file.
 */
export function shouldGroupMediaByModel(
  categoryId: string | null | undefined,
): boolean {
  const id = (categoryId || "").trim().toLowerCase();
  return (
    id === "machine" ||
    id === "inks" ||
    id === "media" ||
    id === "tools" ||
    id === "auxiliary"
  );
}

/** Inks / Media / Tools: files live directly under the type (item class) folder. */
export function flatCmsFileProductId(inventoryId: string, kind: string): string {
  return `${inventoryId}__${kind}`;
}

export function inventoryIdFromFlatCmsFileProductId(productId: string): string {
  const m = String(productId || "").match(
    /^(.*)__(brochure|images|videos)(?:__\d+)?$/i,
  );
  return m ? m[1] : productId;
}

/** Unique product id per CMS media file (supports multiple URLs per inventory row). */
export function cmsMediaProductId(
  inventoryId: string,
  kind: string,
  index = 0,
): string {
  if (index <= 0) return flatCmsFileProductId(inventoryId, kind);
  return `${inventoryId}__${kind}__${index}`;
}

/**
 * CMS may store one URL or several (JSON array, pipe, or comma-separated list).
 * KelinConnect Product Database uploads can attach multiple files per field.
 */
export function expandMediaUrls(url: string): string[] {
  const value = String(url ?? "").trim();
  if (!value) return [];

  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => resolveCmsMediaUrl(String(entry ?? "")))
          .filter(Boolean);
      }
    } catch {
      // fall through to single-value handling
    }
  }

  if (value.includes("|")) {
    return value
      .split("|")
      .map((part) => resolveCmsMediaUrl(part.trim()))
      .filter(Boolean);
  }

  if (/,https?:\/\//i.test(value)) {
    return value
      .split(/,(?=https?:\/\/)/i)
      .map((part) => resolveCmsMediaUrl(part.trim()))
      .filter(Boolean);
  }

  return [resolveCmsMediaUrl(value)];
}

export function mediaUrlCount(url: string): number {
  return expandMediaUrls(url).length;
}

export function flatCmsFilesFromRows(
  rowsByKind: { kind: string; rows: CmsMediaRow[] }[],
  itemClassId: string,
  basePath: string[],
): ProductOut[] {
  const products: ProductOut[] = [];
  const seen = new Set<string>();
  for (const { kind, rows } of rowsByKind) {
    for (const row of rows) {
      const urls = expandMediaUrls(row.media_url);
      urls.forEach((url, index) => {
        const id = cmsMediaProductId(row.inventory_id, kind, index);
        if (seen.has(id)) return;
        seen.add(id);
        products.push({
          id,
          name:
            urls.length > 1
              ? `${row.inventory_name} (${index + 1})`
              : row.inventory_name,
          sku: row.inventory_id,
          description: "",
          file_url: url,
          folder_id: itemClassId,
          folder_path: basePath,
        });
      });
    }
  }
  products.sort((a, b) => a.name.localeCompare(b.name));
  return products;
}

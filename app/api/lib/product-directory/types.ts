export type FolderKind = "category" | "subcategory" | "folder" | string;

export type InventoryFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  kind: FolderKind;
  child_count: number | null;
  path: string[];
};

export type InventoryProduct = {
  id: string;
  name: string;
  sku: string;
  description: string;
  file_url: string;
  folder_id: string;
  folder_path: string[];
};

export type BrowseResult = {
  folders: InventoryFolder[];
  products: InventoryProduct[];
};

export type ApiOk<T> = {
  status: "success";
  success: true;
  data: T;
};

export type ApiErr = {
  status: "error";
  success?: false;
  message: string;
};

import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const host = process.env.MYSQL_HOST || "127.0.0.1";
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER || "";
  const password = process.env.MYSQL_PASSWORD || "";
  const database = process.env.MYSQL_INVENTORY_DATABASE || "db_kelin_inventory";
  if (!user || !password) {
    throw new Error("MYSQL_USER / MYSQL_PASSWORD env not set");
  }
  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4",
    // Remote MySQL on this host typically speaks plaintext on 3306.
    ssl: undefined,
  });
  return pool;
}

export type Db = Pool;
export type { RowDataPacket, ResultSetHeader };

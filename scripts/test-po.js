const mysql = require('mysql2/promise');
require('dotenv').config({ path: '../.env.local' });

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_PURCHASE_DATABASE || 'db_purchase'
  });

  try {
    const [openPoWithDetails] = await connection.query(
      `SELECT COUNT(DISTINCT d.order_nbr) as count 
       FROM purchase_order_details d
       JOIN purchase_history h ON h.order_nbr COLLATE utf8mb4_unicode_ci = d.order_nbr
       WHERE h.status = 'Open'`
    );
    console.log('Open POs with lines in purchase_order_details:', openPoWithDetails[0].count);

    const [totalDetails] = await connection.query(
      `SELECT COUNT(*) as count FROM purchase_order_details`
    );
    console.log('Total purchase order details count:', totalDetails[0].count);

    const [sampleDetails] = await connection.query(
      `SELECT d.* FROM purchase_order_details d
       JOIN purchase_history h ON h.order_nbr COLLATE utf8mb4_unicode_ci = d.order_nbr
       WHERE h.status = 'Open' LIMIT 5`
    );
    console.log('Sample Open PO details:', sampleDetails);
  } catch (err) {
    console.error(err);
  } finally {
    // MySQL service pool is not directly exposed to end, so we might need process.exit(0)
    process.exit(0);
  }
}

main();

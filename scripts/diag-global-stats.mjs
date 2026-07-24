import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { MySqlService } from "../services/mysql.js";

const stats = await MySqlService.getGlobalStats("", "", "main");
console.log("All branches stats:", JSON.stringify(stats, null, 2));

const mainStats = await MySqlService.getGlobalStats("MAIN", "", "main");
console.log("MAIN branch stats:", JSON.stringify(mainStats, null, 2));

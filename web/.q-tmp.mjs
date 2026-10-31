import pg from "pg";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r = await p.query(process.argv.slice(2).join(" "));
console.log(r.rows.map(x=>JSON.stringify(x)).join("\n"));
await p.end();

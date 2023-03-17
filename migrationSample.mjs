import { Kysely, sql } from "kysely";

/**
 * @param db {Kysely<any>}
 */
export async function up(db) {
    console.log("4th up...");
    console.log("add winner column in registration")
    const registrationColumnNames = await db
        .selectFrom("information_schema.columns")
        .select("column_name")
        .where(sql`table_name = 'registration'`)
        .execute(db);
    if (
        !registrationColumnNames
        .map((x) => x.column_name)
        .includes("selected")
    ) {
        await db.schema
        .alterTable("registration")
        .addColumn("selected", "boolean", (col) => col.defaultTo(false))
        .execute();
    }
    
    console.log("add signature_public column in mint_settings")
    const mintSettingsColumnNames = await db
        .selectFrom("information_schema.columns")
        .select("column_name")
        .where(sql`table_name = 'mint_settings'`)
        .execute(db);
    if (!mintSettingsColumnNames.map((x) => x.column_name).includes("signature_public")) {

        await db.schema
        .alterTable("mint_settings")
        .addColumn("signature_public", "varchar(100)")
        .execute();
    }
    console.log("done!")
}

/**
 * @param db {Kysely<any>}
 */
export async function down(db) {
    console.log("5th down...");
    const mintSettingsColumnNames = await db
        .selectFrom("information_schema.columns")
        .select("column_name")
        .where(sql`table_name = 'mint_settings'`)
        .execute(db);
    if (mintSettingsColumnNames.map((x) => x.column_name).includes("signature_public")) {
        await db.schema
        .alterTable("mint_settings")
        .dropColumn("signature_public")
        .execute();
    }
    const registrationColumnNames = await db
        .selectFrom("information_schema.columns")
        .select("column_name")
        .where(sql`table_name = 'registration'`)
        .execute(db);
    if (registrationColumnNames.map((x) => x.column_name).includes("selected")) {
        await db.schema
        .alterTable("registration")
        .dropColumn("selected")
        .execute();
    }
  
    console.log("done!");
  }
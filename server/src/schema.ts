import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// One saved town per artifact (single row, id = 1). The grid is the whole
// 24x24 tile map serialized as one character per tile, row-major.
export const towns = sqliteTable("towns", {
  id: integer("id").primaryKey(),
  grid: text("grid").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

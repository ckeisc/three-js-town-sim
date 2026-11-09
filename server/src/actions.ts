import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

const GRID_LEN = 24 * 24;
const GRID_CHARS = /^[.RHSOPTD]+$/;

const townResponse = z.object({
  grid: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const Actions = {
  getTown: defineAction({
    description: "Returns the saved town grid (24x24 tile codes) or null when no town has been saved yet.",
    request: z.object({}),
    response: townResponse,
    async handler(ctx): Promise<z.infer<typeof townResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.towns)
        .where(eq(schema.towns.id, 1))
        .limit(1);
      const row = rows[0];
      if (!row) return { grid: null, updatedAt: null };
      return { grid: row.grid, updatedAt: row.updatedAt.toISOString() };
    },
  }),

  saveTown: defineAction({
    description: "Saves the town grid (576 tile codes, row-major) as the single stored town.",
    request: z.object({
      grid: z.string().length(GRID_LEN).regex(GRID_CHARS),
    }),
    response: z.object({ ok: z.literal(true), updatedAt: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db
        .insert(schema.towns)
        .values({ id: 1, grid: args.grid, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.towns.id,
          set: { grid: args.grid, updatedAt: now },
        });
      ctx.invalidateQueries();
      return { ok: true as const, updatedAt: now.toISOString() };
    },
  }),

  clearTown: defineAction({
    description: "Deletes the saved town so the starter town is shown again on next load.",
    request: z.object({}),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.towns).where(eq(schema.towns.id, 1));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),
} satisfies ActionsModule;

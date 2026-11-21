# apps/web

## Server actions

Colocated `actions.ts` / `cron-actions.ts`. Pattern: `"use server"` → session → correct authz helper → Zod → Drizzle → `revalidatePath`.

## Validators

Zod schemas live in `src/lib/validators/`. Export both the schema and the inferred type:

```ts
export const createAgentSchema = z.object({ ... });
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
```

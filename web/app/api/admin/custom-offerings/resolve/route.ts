import { handleResolve } from "../_resolve";

/** POST /api/admin/custom-offerings/resolve (see ../_resolve.ts for the body). */
export async function POST(req: Request) {
  return handleResolve(req);
}

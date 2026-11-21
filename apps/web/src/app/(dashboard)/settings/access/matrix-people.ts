import type { CompanyPerson } from "../members/people";
import type { AccessMatrixPerson } from "./access-matrix";

/**
 * Matrix rows for Access & roles: the owner and members. Client users hold no page keys (a
 * client row's pagePermissions are never read), so they are counted, not listed.
 */
export function accessMatrixPeople(people: CompanyPerson[]): {
  matrix: AccessMatrixPerson[];
  clientNote: string | null;
} {
  const matrix: AccessMatrixPerson[] = [];
  let clients = 0;
  for (const p of people) {
    if (p.kind === "client" || !p.pagePermissions) {
      clients += 1;
      continue;
    }
    matrix.push({
      userId: p.userId,
      name: p.name,
      email: p.email,
      kind: p.kind,
      roleLabel: p.roleLabel,
      pagePermissions: p.pagePermissions,
      approvesAny: p.approvesAny,
    });
  }
  const clientNote =
    clients === 0
      ? null
      : clients === 1
        ? "1 client user sees only the client portal and is not listed here."
        : `${clients} client users see only the client portal and are not listed here.`;
  return { matrix, clientNote };
}

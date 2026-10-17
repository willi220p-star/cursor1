// SHIM: replaced by the real module on merge
import type { Can, OrgRole, Space } from './contracts';

const can: Can = () => true;
const access = { can, currentSpaceId: null as string | null, spaces: [] as Space[], orgRole: 'owner' as OrgRole };

export function useAccess(): { can: Can; currentSpaceId: string | null; spaces: Space[]; orgRole: OrgRole } {
  return access;
}

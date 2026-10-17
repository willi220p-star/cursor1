// SHIM: replaced by the real module on merge
import type { Can, OrgRole, Profile, Space } from './contracts';

const can: Can = () => true;
const access = { can, profile: null as Profile | null, currentSpaceId: null as string | null, spaces: [] as Space[], orgRole: 'owner' as OrgRole };

export function useAccess(): typeof access {
  return access;
}

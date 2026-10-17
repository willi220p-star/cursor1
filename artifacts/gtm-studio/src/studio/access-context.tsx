// SHIM: replaced by the real module on merge
import type { Can, OrgRole, Profile } from './contracts';

const can: Can = () => true;

export function useAccess(): { can: Can; profile: Profile | null; orgRole: OrgRole } {
  return { can, profile: null, orgRole: 'owner' };
}

import type {AdminSelf} from '../types';

export function shouldShowAdminNavigation(admin: AdminSelf | null): boolean {
  return admin?.capabilities.accessAdmin === true
    || admin?.canManageGuildPublishing === true;
}

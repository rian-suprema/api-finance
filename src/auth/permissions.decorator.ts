import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'sayplus:permissions';

/**
 * Declara o que a rota EXIGE (codes do catálogo SayPlus). O PermissionsGuard
 * confere contra o claim `permissions[]` do token — todos os codes declarados
 * precisam estar concedidos.
 *
 * Nova feature = registrar o code no catálogo SayPlus + 1 constante em
 * permissions.constants.ts + este decorator na rota. A concessão (quem tem o
 * quê) é governada na SayPlus em runtime — zero redeploy.
 */
export const Permissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);

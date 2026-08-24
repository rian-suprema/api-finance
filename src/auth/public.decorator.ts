import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'sayplus:isPublic';

/**
 * Marca rota (ou controller inteiro) como pública: dispensa JWT e permissões.
 *
 * Uso RESTRITO por decisão de arquitetura: probes de saúde (o kubelet não
 * envia token). Qualquer outro uso deve ser exceção consciente e revisada —
 * o default do archetype é toda rota fechada (deny-by-default).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

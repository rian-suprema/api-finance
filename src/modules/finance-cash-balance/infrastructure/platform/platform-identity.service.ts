import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import { createHash } from 'crypto';

import { platformConfig } from '../../../../config/configuration';
import { BRANDS } from '../../cash-balance.constants';
import type { BrandAccess } from '../../domain/cash-balance.types';

/**
 * O módulo finance não tem tabela de usuários: as marcas às quais o usuário
 * tem vínculo vêm da API principal (`GET /auth/me`), repassando o Bearer do
 * próprio usuário. O JWT carrega apenas o tenant ativo, por isso a consulta.
 *
 * Cache curto em memória, chaveado por hash do token (o token nunca é
 * armazenado nem logado).
 */

const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface PlatformMeResponse {
  data: {
    tenants: { id: string; slug: string }[];
  };
}

interface CacheEntry {
  brands: BrandAccess[];
  expiresAt: number;
}

@Injectable()
export class PlatformIdentityService {
  private readonly logger = new Logger(PlatformIdentityService.name);
  private readonly http: AxiosInstance;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(platformConfig.KEY)
    config: ConfigType<typeof platformConfig>,
  ) {
    this.http = axios.create({
      baseURL: config.apiUrl,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  /** Marcas do módulo às quais o usuário tem vínculo, com o tenantId de cada. */
  async resolveAccessibleBrands(authorization: string): Promise<BrandAccess[]> {
    const cacheKey = createHash('sha256').update(authorization).digest('hex');
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) return cached.brands;

    const tenants = await this.fetchTenants(authorization);

    const brands = BRANDS.flatMap((brand) => {
      const tenant = tenants.find((item) => item.slug === brand.tenantSlug);
      return tenant ? [{ brand: brand.key, tenantId: tenant.id }] : [];
    });

    this.cache.set(cacheKey, { brands, expiresAt: Date.now() + CACHE_TTL_MS });
    this.evictExpired();

    return brands;
  }

  private async fetchTenants(authorization: string) {
    try {
      const response = await this.http.get<PlatformMeResponse>('/auth/me', {
        headers: { Authorization: authorization },
      });
      return response.data?.data?.tenants ?? [];
    } catch (error) {
      this.logger.error(`Falha ao resolver marcas do usuário: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Não foi possível validar as marcas do usuário');
    }
  }

  private evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }
}

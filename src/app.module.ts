import { ClassSerializerInterceptor, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { appConfig, databaseConfig } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      load: [appConfig, databaseConfig],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    // Infraestrutura transversal
    DatabaseModule,
    HealthModule,
    // Módulos de negócio
    UsersModule,
  ],
  providers: [
    // Pipes/filters/interceptors globais registrados via DI (APP_*) — forma
    // recomendada pela doc do NestJS: participam da injeção de dependências
    // e valem também nos testes e2e que montam o AppModule.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true, // remove propriedades fora do DTO
        forbidNonWhitelisted: true, // ...e rejeita payloads com propriedades extras
        transform: true, // converte payloads em instâncias do DTO
        transformOptions: { enableImplicitConversion: true },
      }),
    },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    // Aplica @Exclude/@Expose das entidades na serialização das respostas
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
  ],
})
export class AppModule {}

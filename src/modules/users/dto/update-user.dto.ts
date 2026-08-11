import { PartialType } from '@nestjs/swagger';

import { CreateUserDto } from './create-user.dto';

/**
 * PUT /user/{username} — PartialType (mapped type do @nestjs/swagger):
 * herda validações e metadados OpenAPI do CreateUserDto tornando tudo opcional.
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {}

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UserDto } from './dto/user.dto.js';
import { UserRole } from './entities/user.entity.js';
import { CurrentUser, Roles } from '../jwt-token/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';

@Controller('users')
@Roles(UserRole.USER)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @Roles(UserRole.USER, UserRole.ADMIN)
  me(@CurrentUser() user: AuthUser) {
    return this.usersService.me(user);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UserDto,
  ) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }
}

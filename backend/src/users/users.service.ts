import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserDto, UserResponseDto } from './dto/user.dto.js';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity.js';
import { AuthSession } from '../auth/entities/auth-session.entity.js';
import { Not, Repository, QueryFailedError } from 'typeorm';
import { UserRole } from './entities/user.entity.js';
import type { AuthUser } from '../auth/auth.types.js';
import * as argon2 from 'argon2';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(AuthSession)
    private readonly authSessionRepository: Repository<AuthSession>,
  ) {}

  async create(createUserDto: UserDto): Promise<UserResponseDto> {
    const email = createUserDto.email.trim().toLowerCase();

    if (await this.userRepository.exists({ where: { email } })) {
      throw new ConflictException('Email already in use');
    }

    const user = this.userRepository.create({
      ...createUserDto,
      email,
      password: await argon2.hash(createUserDto.password, {
        type: argon2.argon2id,
      }),
      role: UserRole.USER,
    });

    try {
      const savedUser = await this.userRepository.save(user);

      return new UserResponseDto(savedUser);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code ===
          'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new ConflictException('Email already in use');
      }

      throw error;
    }
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findOne(id: number) {
    const user = await this.userRepository.findOneBy({ id });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async update(id: number, updateUserDto: UserDto): Promise<UserResponseDto> {
    const user = await this.findOne(id);
    let passwordChanged = false;

    if (updateUserDto.name !== undefined) {
      user.name = updateUserDto.name;
    }

    if (updateUserDto.email !== undefined) {
      const email = updateUserDto.email.trim().toLowerCase();

      const exists = await this.userRepository.exists({
        where: {
          email,
          id: Not(id),
        },
      });

      if (exists) {
        throw new ConflictException('Email already in use');
      }

      user.email = email;
    }

    if (updateUserDto.password !== undefined) {
      user.password = await argon2.hash(updateUserDto.password, {
        type: argon2.argon2id,
      });
      passwordChanged = true;
    }

    try {
      const updatedUser = await this.userRepository.save(user);

      if (passwordChanged) {
        // force re-login on every device
        await this.authSessionRepository.delete({ userId: id });
      }

      return new UserResponseDto(updatedUser);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code ===
          'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new ConflictException('Email already in use');
      }

      throw error;
    }
  }

  async remove(id: number): Promise<{ message: string }> {
    const result = await this.userRepository.delete(id);

    if (!result.affected) {
      throw new NotFoundException('User not found');
    }

    return {
      message: 'User deleted successfully',
    };
  }

  async me(user: AuthUser): Promise<UserResponseDto> {
    return new UserResponseDto(await this.findOne(user.id));
  }

  async findUserPasswordByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: {
        email: email.trim().toLowerCase(),
      },
      select: {
        password: true,
      },
    });
  }
}

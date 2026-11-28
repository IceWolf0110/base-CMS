import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module.js';
import { JwtTokenModule } from './jwt-token/jwt-token.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,

      validate: (config) => {
        console.log(config.NODE_ENV)
        
        if (
          config.NODE_ENV !== 'development' &&
          config.NODE_ENV !== 'production'
        ) {
          throw new Error(
            'NODE_ENV must be either "development" or "production"',
          );
        }

        return config;
      },
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],

      useFactory: (configService: ConfigService) => {
        const isProduction =
          configService.get<string>('NODE_ENV') === 'production';

        return {
          type: 'better-sqlite3' as const,

          database:
            configService.get<string>('DATABASE_PATH') ??
            'database/database.sqlite',

          autoLoadEntities: true,
          synchronize: !isProduction,
          dropSchema: !isProduction,
        };
      },
    }),

    UsersModule,
    AuthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
